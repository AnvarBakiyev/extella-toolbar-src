// ── REPO ANALYZER ──────────────────────────────────────────────────────────
// Deterministic GitHub repository digest used to seed the install prompt.
//   harvest() — fetches the repo tree, README, and key manifest/code samples
//   via the GitHub API and compresses them into a single text digest plus a few
//   structured signals. Never rejects; degrades to a metadata-only digest.
// Exposes: ETB.repoAnalyzer.harvest(repoData, ghToken)

ETB.repoAnalyzer = (function () {

  var GH_API = 'https://api.github.com';

  // Root-level manifest files worth including in the digest
  var MANIFEST_FILES = [
    'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py',
    'Cargo.toml', 'go.mod', 'Dockerfile', 'docker-compose.yml',
    'composer.json', 'Gemfile', 'Makefile'
  ];

  // Paths that add noise without signal — excluded from the tree digest
  var NOISE_RE = /(^|\/)(node_modules|dist|build|vendor|\.git|__pycache__|coverage|\.idea|\.vscode)\//;
  var BINARY_RE = /\.(png|jpe?g|gif|svg|ico|woff2?|ttf|eot|mp4|mp3|zip|tar|gz|lock|min\.js|min\.css|fcstd?|step|stp|iges|igs|brep|ply|obj|stl|3mf|dwg|dxf)$/i;

  function _hdrs(ghToken) {
    var h = { 'Accept': 'application/vnd.github.v3+json' };
    if (ghToken) h['Authorization'] = 'token ' + ghToken;
    return h;
  }

  // Resolves to parsed JSON or null — harvest tolerates partial failures
  function _fetchJson(url, ghToken) {
    return fetch(url, { headers: _hdrs(ghToken) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function _b64decode(content) {
    try { return atob(String(content || '').replace(/\n/g, '')); }
    catch (e) { return ''; }
  }

  var MAX_CODE_SAMPLES = 6;
  var CODE_SAMPLE_CHARS = 2000;
  var STRUCTURE_DIGEST_CHARS = 12000;

  // Heuristic repo classification from tree + metadata (no LLM)
  function _inferRepoClass(treePaths, rd) {
    var paths = treePaths || [];
    var lang = String((rd && rd.language) || '').toLowerCase();
    var hasHomepage = !!(rd && rd.homepage);
    var hasPages = !!(rd && rd.has_pages);
    var hasIndex = paths.indexOf('index.html') !== -1;
    var hasMod = paths.some(function (p) {
      return p.indexOf('src/Mod/') !== -1 || /\/Mod\//.test(p);
    });
    var hasCMake = paths.indexOf('CMakeLists.txt') !== -1;
    var hasCmd = paths.some(function (p) {
      return /^cmd\//.test(p) || /\/cli[./]/i.test(p) || /(^|\/)cli_/i.test(p);
    });
    var hasExamples = paths.some(function (p) {
      return /^examples?\//.test(p) || /\/examples?\//.test(p);
    });
    var hasPkgJson = paths.indexOf('package.json') !== -1;
    var hasPyProject = paths.indexOf('pyproject.toml') !== -1;
    var hasGoMod = paths.indexOf('go.mod') !== -1;
    var pkgCount = paths.filter(function (p) {
      return /^packages\//.test(p) || /^apps\//.test(p);
    }).length;

    if (hasHomepage && (hasPages || hasIndex)) return 'web_app';
    if (pkgCount >= 3) return 'monorepo';
    if (hasMod || (hasCMake && lang === 'c++')) return 'desktop_app';
    if (hasCmd || paths.some(function (p) {
      return /(^|\/)main\.(py|go|rs|c)$/i.test(p) || p === 'main.go';
    })) return 'cli';
    if (hasPkgJson || hasPyProject || hasGoMod || lang === 'python' || lang === 'javascript') {
      return 'library';
    }
    if (hasHomepage && !hasCMake) return 'api_service';
    return 'unknown';
  }

  // Pick paths likely to reveal public API / CLI / examples
  function _pickCapabilitySamplePaths(treePaths, repoClass) {
    var paths = treePaths || [];
    var scored = [];
    var seen = {};

    function add(path, score) {
      if (!path || seen[path] || NOISE_RE.test(path) || BINARY_RE.test(path)) return;
      seen[path] = true;
      scored.push({ path: path, score: score });
    }

    paths.forEach(function (p) {
      if ((/^examples?\//.test(p) || /\/examples?\//.test(p)) &&
          /\.(py|js|ts|md|txt|cpp|h|c|rs|go|json|toml|yaml|yml|cmake|sh|xml)$/i.test(p)) {
        add(p, 10);
      }
      if (/__init__\.py$/.test(p) && p.split('/').length <= 4) add(p, 9);
      if (/(^|\/)main\.(py|go|rs|c)$/i.test(p) || p === 'main.go') add(p, 9);
      if (/^cmd\//.test(p) || /\/cli[./]/i.test(p)) add(p, 8);
      if (/cli[_-]/i.test(p) && /\.(py|go|rs|js|ts)$/.test(p)) add(p, 8);
      if (repoClass === 'desktop_app' && /src\/Mod\//.test(p) && /\.(py|cpp|h)$/.test(p)) add(p, 7);
      if (/^src\/[^/]+\.(py|js|ts|go|rs)$/.test(p)) add(p, 6);
      if (/^lib\//.test(p) && p.split('/').length <= 3) add(p, 5);
      if (/^api\//.test(p) || /\/api\//.test(p)) add(p, 5);
    });

    scored.sort(function (a, b) { return b.score - a.score || (a.path < b.path ? -1 : 1); });
    return scored.slice(0, MAX_CODE_SAMPLES).map(function (s) { return s.path; });
  }

  function _fetchFileExcerpt(full, path, branch, ghToken) {
    return _fetchJson(GH_API + '/repos/' + full + '/contents/' +
      encodeURIComponent(path) + '?ref=' + encodeURIComponent(branch || 'main'), ghToken)
      .then(function (d) {
        if (!d || !d.content) return null;
        return { path: path, excerpt: _b64decode(d.content).slice(0, CODE_SAMPLE_CHARS) };
      });
  }

  function _capStructureDigest(text) {
    var s = String(text || '');
    if (s.length <= STRUCTURE_DIGEST_CHARS) return s;
    return s.slice(0, STRUCTURE_DIGEST_CHARS) +
      '\n\n[... structure digest truncated at ' + STRUCTURE_DIGEST_CHARS + ' chars ...]';
  }

  // Compress the recursive git tree into <=200 representative paths
  function _compressTree(items) {
    var paths = (items || [])
      .filter(function (i) { return i.type === 'blob'; })
      .map(function (i) { return i.path; })
      .filter(function (p) { return !NOISE_RE.test(p) && !BINARY_RE.test(p); });

    // Prefer shallow paths (root, then 1 level deep, ...) so structure is visible
    paths.sort(function (a, b) {
      var da = a.split('/').length, db = b.split('/').length;
      return da !== db ? da - db : (a < b ? -1 : 1);
    });

    return { shown: paths.slice(0, 200), total: paths.length };
  }

  // ── harvest ────────────────────────────────────────────────────
  // Returns Promise<{text, readme, uiSignals, repo_class, code_samples,
  // tree_paths}> — never rejects.
  function harvest(rd, ghToken) {
    var full = rd.full_name;
    var branch = rd.default_branch || 'main';

    var treeP = _fetchJson(GH_API + '/repos/' + full + '/git/trees/' +
      encodeURIComponent(branch) + '?recursive=1', ghToken);
    var readmeP = _fetchJson(GH_API + '/repos/' + full + '/readme', ghToken);

    return Promise.all([treeP, readmeP]).then(function (res) {
      var tree = _compressTree(res[0] && res[0].tree);
      var readme = res[1] && res[1].content ? _b64decode(res[1].content).slice(0, 6000) : '';

      // Pick root-level manifest files actually present in the tree (max 4)
      var present = MANIFEST_FILES.filter(function (f) {
        return tree.shown.indexOf(f) !== -1;
      }).slice(0, 4);

      var manifestPs = present.map(function (f) {
        return _fetchJson(GH_API + '/repos/' + full + '/contents/' +
          encodeURIComponent(f) + '?ref=' + encodeURIComponent(branch), ghToken)
          .then(function (d) {
            return { name: f, text: d && d.content ? _b64decode(d.content).slice(0, 2000) : '' };
          });
      });

      return Promise.all(manifestPs).then(function (manifests) {
        var uiSignals = {
          homepage: rd.homepage || '',
          hasPages: !!rd.has_pages,
          hasDocs: tree.shown.some(function (p) { return p.indexOf('docs/') === 0; }),
          hasExamples: tree.shown.some(function (p) { return p.indexOf('examples/') === 0; }),
          hasIndexHtml: tree.shown.indexOf('index.html') !== -1
        };

        var parts = [];
        parts.push('=== REPOSITORY META ===');
        parts.push('Repo: ' + full);
        parts.push('Description: ' + (rd.description || '—'));
        parts.push('Language: ' + (rd.language || '—'));
        parts.push('Topics: ' + ((rd.topics || []).join(', ') || '—'));
        parts.push('Stars: ' + (rd.stargazers_count || 0) +
          ' | License: ' + ((rd.license && rd.license.spdx_id) || '—') +
          ' | Last push: ' + (rd.pushed_at || '—'));
        parts.push('Homepage: ' + (rd.homepage || '—') + ' | GitHub Pages: ' + (rd.has_pages ? 'yes' : 'no'));

        parts.push('\n=== FILE TREE (' + tree.shown.length + ' of ' + tree.total + ' files) ===');
        parts.push(tree.shown.join('\n'));

        if (readme) {
          parts.push('\n=== README (truncated) ===');
          parts.push(readme);
        }

        manifests.forEach(function (m) {
          if (m.text) {
            parts.push('\n=== ' + m.name + ' (truncated) ===');
            parts.push(m.text);
          }
        });

        var repoClass = _inferRepoClass(tree.shown, rd);
        parts.push('\n=== REPO CLASS (heuristic) ===');
        parts.push(repoClass);

        var structureText = _capStructureDigest(parts.join('\n'));
        var samplePaths = _pickCapabilitySamplePaths(tree.shown, repoClass);

        return Promise.all(samplePaths.map(function (p) {
          return _fetchFileExcerpt(full, p, branch, ghToken);
        })).then(function (samples) {
          var codeSamples = samples.filter(function (s) { return s && s.excerpt; });
          return {
            text: structureText,
            readme: readme,
            uiSignals: uiSignals,
            repo_class: repoClass,
            code_samples: codeSamples,
            tree_paths: tree.shown
          };
        });
      });
    }).catch(function () {
      // Degenerate digest from metadata only
      return {
        text: 'Repo: ' + full + '\nDescription: ' + (rd.description || '') +
          '\nLanguage: ' + (rd.language || ''),
        readme: '',
        uiSignals: { homepage: rd.homepage || '', hasPages: !!rd.has_pages },
        repo_class: 'unknown',
        code_samples: [],
        tree_paths: []
      };
    });
  }

  // Heuristic install-analysis: determine plugin category from digest without LLM.
  // Returns { category, mode, skipPhase1: true } when confident, null when ambiguous.
  // Used to skip the LLM SubAgent-A (Phase 1) for simple repos.
  function inferInstallAnalysis(digest) {
    if (!digest) return null;
    var rc      = digest.repo_class || 'unknown';
    var paths   = digest.tree_paths || [];
    var text    = digest.text || '';
    var readme  = digest.readme || '';
    var signals = digest.uiSignals || {};

    // Bail immediately for clearly complex / ambiguous repo types.
    if (rc === 'monorepo' || rc === 'desktop_app' || rc === 'unknown') return null;

    // Detect infrastructure that always requires multi-step install (category 1b).
    var hasDocker = paths.some(function (p) {
      return /^(Dockerfile|docker-compose\.ya?ml)$/.test(p) ||
             /\/(Dockerfile|docker-compose\.ya?ml)$/.test(p);
    });
    if (hasDocker) return null;

    // Check package.json scripts for "start" / "dev" → runnable app → 1b, needs LLM.
    var pkgJsonMatch = text.match(/=== package\.json[^=]*===\s*([\s\S]*?)(?===|$)/);
    if (pkgJsonMatch) {
      try {
        var pkg = JSON.parse(pkgJsonMatch[1].trim().split('\n[')[0]);
        var scripts = (pkg && pkg.scripts) || {};
        if (scripts.start || scripts.dev || scripts.serve || scripts.run) return null;
      } catch (_) { /* non-fatal — keep inferring */ }
    }

    // Check README for common runnable-app indicators.
    var readmeLower = readme.toLowerCase();
    var hasRunCmds = /npm\s+start|yarn\s+start|docker\s+compose\s+up|npx\s+\w+\s+start/.test(readmeLower);
    if (hasRunCmds) return null;

    // web_app with index.html in repo root → category 1a (static site served by http.server).
    if (rc === 'web_app' && signals.hasIndexHtml) {
      return { category: '1a', mode: 'repo_ui', skipPhase1: true };
    }

    // library or api_service — serve its assets via http.server + generate index.html wrapper.
    if (rc === 'library' || rc === 'api_service') {
      return { category: '2', mode: 'repo_ui', skipPhase1: true };
    }

    // cli tool with no web UI → category 3 (generated control panel).
    if (rc === 'cli') {
      return { category: '3', mode: 'generated_ui', skipPhase1: true };
    }

    return null; // Anything else — let LLM Phase 1 decide.
  }

  return {
    harvest: harvest,
    inferInstallAnalysis: inferInstallAnalysis
  };
})();
