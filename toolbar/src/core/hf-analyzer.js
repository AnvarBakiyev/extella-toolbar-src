// ── HF ANALYZER ─────────────────────────────────────────────────────────────
// Fetches metadata, README, and estimates resources for a HuggingFace Space or
// Model. Parallel to repo-analyzer.js for GitHub.
//
// Exposes: ETB.hfAnalyzer.harvest(kind, id, token?) -> digest object
//          ETB.hfAnalyzer.fetchMeta(kind, id, token?)
//          ETB.hfAnalyzer.estimateResources(meta)

ETB.hfAnalyzer = (function () {

  var HF_BASE = 'https://huggingface.co';
  var HF_API  = 'https://huggingface.co/api';

  // Bytes-per-element estimates for common dtypes
  var DTYPE_BYTES = {
    'F32': 4, 'F16': 2, 'BF16': 2, 'I8': 1, 'I4': 0.5,
    'float32': 4, 'float16': 2, 'bfloat16': 2, 'int8': 1, 'int4': 0.5,
    'fp32': 4, 'fp16': 2, 'bf16': 2
  };

  // Weight file extensions worth summing for disk estimate
  var WEIGHT_RE = /\.(safetensors|bin|pt|pth|gguf|ggml|ot|msgpack|npz)$/i;

  function _hdrs(token) {
    var h = { 'Accept': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  function _fetchJson(url, token) {
    return fetch(url, { headers: _hdrs(token) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function _fetchText(url, token) {
    return fetch(url, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .catch(function () { return ''; });
  }

  // Parse YAML front-matter from a README.md string
  function _parseReadmeFrontMatter(text) {
    if (!text) return {};
    var m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    var yaml = m[1];
    var result = {};
    yaml.split(/\r?\n/).forEach(function (line) {
      var kv = line.match(/^([a-z_][a-z0-9_-]*):\s*(.*)$/i);
      if (kv) result[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
    });
    return result;
  }

  // Fetch Space or Model metadata with all useful expansions
  function fetchMeta(kind, id, token) {
    var endpoint = (kind === 'model' ? 'models' : 'spaces') + '/' + id;
    var url = HF_API + '/' + endpoint +
      '?expand=siblings&expand=safetensors&expand=cardData&expand=usedStorage&full=true';
    return _fetchJson(url, token);
  }

  // Fetch README from HuggingFace (works for both spaces and models)
  function _fetchReadme(kind, id, token) {
    var prefix = kind === 'space' ? 'spaces/' : '';
    var url = HF_BASE + '/' + prefix + id + '/raw/main/README.md';
    return _fetchText(url, token);
  }

  // Estimate disk/VRAM/hardware requirements from metadata
  function estimateResources(meta, kind) {
    if (!meta) return {};
    var result = {};

    // Disk estimate: sum weight file sizes from siblings
    var diskBytes = 0;
    var siblings = meta.siblings || [];
    siblings.forEach(function (s) {
      if (!s.rfilename) return;
      if (WEIGHT_RE.test(s.rfilename) && s.lfs && s.lfs.size) {
        diskBytes += s.lfs.size;
      }
    });
    // Fallback to usedStorage if no weight files found
    if (!diskBytes && meta.usedStorage) diskBytes = meta.usedStorage;
    if (diskBytes) result.diskBytes = diskBytes;

    // VRAM estimate: from safetensors metadata
    if (meta.safetensors && meta.safetensors.total) {
      var totalParams = meta.safetensors.total;
      var dtype = meta.safetensors.dtype || 'F32';
      var bytesPerParam = DTYPE_BYTES[dtype] || 4;
      // Add 30% overhead for activations and optimizer state (inference only)
      result.vramEstimate = Math.ceil(totalParams * bytesPerParam * 1.3);
      result.paramCount = totalParams;
    }

    // Hardware hint from Space runtime or card front-matter
    if (kind === 'space') {
      if (meta.runtime && meta.runtime.hardware) {
        result.hardware = meta.runtime.hardware;
      }
    }

    return result;
  }

  function _fmtBytes(b) {
    if (!b || b <= 0) return null;
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
    return (b / 1e3).toFixed(0) + ' KB';
  }

  // Build a text digest for the install prompt
  function _buildDigest(kind, id, meta, frontMatter, resources) {
    if (!meta) return 'No metadata available for ' + kind + ':' + id;
    var lines = [];
    lines.push('=== HuggingFace ' + (kind === 'model' ? 'Model' : 'Space') + ': ' + id + ' ===');
    lines.push('Author: ' + (id.includes('/') ? id.split('/')[0] : (meta.author || 'unknown')));
    lines.push('Downloads: ' + (meta.downloads || 0));
    lines.push('Likes: ' + (meta.likes || 0));

    if (meta.pipeline_tag) lines.push('Pipeline: ' + meta.pipeline_tag);
    if (meta.library_name) lines.push('Library: ' + meta.library_name);

    // Space-specific
    if (kind === 'space') {
      var sdk = meta.sdk || frontMatter.sdk || '';
      if (sdk) lines.push('SDK: ' + sdk);
      var sdkVer = meta.sdk_version || frontMatter.sdk_version || '';
      if (sdkVer) lines.push('SDK version: ' + sdkVer);
      var appFile = meta.app_file || frontMatter.app_file || '';
      if (appFile) lines.push('App file: ' + appFile);
      if (meta.runtime && meta.runtime.hardware) lines.push('Hardware: ' + meta.runtime.hardware);
      if (meta.url) lines.push('Live URL: ' + meta.url);
      // The HF space URL follows the pattern https://{owner}-{repo}.hf.space
      var spaceOwner = id.includes('/') ? id.split('/')[0] : '';
      var spaceName  = id.includes('/') ? id.split('/')[1] : id;
      var spaceUrl   = 'https://' + spaceOwner + '-' + spaceName + '.hf.space';
      lines.push('Space live URL pattern: ' + spaceUrl);
    }

    // Model-specific
    if (kind === 'model') {
      if (meta.config) {
        var cfg = meta.config;
        if (cfg.model_type) lines.push('Model type: ' + cfg.model_type);
        if (cfg.architectures) lines.push('Architectures: ' + (cfg.architectures || []).join(', '));
      }
      if (meta.safetensors) {
        var st = meta.safetensors;
        if (st.total) lines.push('Parameters: ' + (st.total / 1e9).toFixed(1) + 'B');
        if (st.dtype)  lines.push('Dtype: ' + st.dtype);
      }
    }

    // Resources section
    if (resources.diskBytes) lines.push('Required disk: ' + _fmtBytes(resources.diskBytes));
    if (resources.vramEstimate) lines.push('Estimated VRAM: ' + _fmtBytes(resources.vramEstimate));
    if (resources.hardware) lines.push('Recommended hardware: ' + resources.hardware);

    // Files (first 30)
    var siblings = (meta.siblings || []).slice(0, 30);
    if (siblings.length) {
      lines.push('');
      lines.push('--- Key files ---');
      siblings.forEach(function (s) {
        var sz = s.lfs && s.lfs.size ? ' (' + _fmtBytes(s.lfs.size) + ')' : '';
        lines.push(s.rfilename + sz);
      });
    }

    // README excerpt (first 3000 chars)
    if (meta._readme && meta._readme.length > 50) {
      lines.push('');
      lines.push('--- README (excerpt) ---');
      lines.push(meta._readme.slice(0, 3000));
    }

    return lines.join('\n');
  }

  // Main entry point: fetch all data and return a rich digest object.
  // Never rejects — degrades to a partial result if any fetch fails.
  function harvest(kind, id, token) {
    var metaPromise = fetchMeta(kind, id, token).catch(function () { return null; });
    var readmePromise = _fetchReadme(kind, id, token).catch(function () { return ''; });

    return Promise.all([metaPromise, readmePromise]).then(function (results) {
      var meta = results[0] || {};
      var readmeText = results[1] || '';
      var frontMatter = _parseReadmeFrontMatter(readmeText);

      // Attach README to meta for digest building
      meta._readme = readmeText;

      var resources = estimateResources(meta, kind);

      // Space URL
      var spaceUrl = '';
      if (kind === 'space') {
        var owner = id.includes('/') ? id.split('/')[0] : '';
        var name  = id.includes('/') ? id.split('/')[1] : id;
        spaceUrl  = 'https://' + owner + '-' + name + '.hf.space';
        // If the metadata has a canonical URL, prefer it
        if (meta.url) spaceUrl = meta.url;
      }

      var sdk = meta.sdk || frontMatter.sdk || '';
      var pipelineTag = meta.pipeline_tag || frontMatter.pipeline_tag || '';
      var appFile = meta.app_file || frontMatter.app_file || '';
      var libraryName = meta.library_name || frontMatter.library_name || '';

      return {
        kind: kind,
        id: id,
        author: id.includes('/') ? id.split('/')[0] : (meta.author || ''),
        name: id.includes('/') ? id.split('/')[1] : id,
        description: meta.description || (meta.cardData && meta.cardData.description) || '',
        sdk: sdk,
        pipelineTag: pipelineTag,
        appFile: appFile,
        libraryName: libraryName,
        spaceUrl: spaceUrl,
        frontMatter: frontMatter,
        resources: resources,
        meta: meta,
        digest: _buildDigest(kind, id, meta, frontMatter, resources)
      };
    }).catch(function () {
      return {
        kind: kind,
        id: id,
        author: id.includes('/') ? id.split('/')[0] : '',
        name: id.includes('/') ? id.split('/')[1] : id,
        description: '',
        sdk: '', pipelineTag: '', appFile: '', libraryName: '',
        spaceUrl: '', frontMatter: {}, resources: {},
        meta: {}, digest: 'Error fetching metadata for ' + id
      };
    });
  }

  return {
    fetchMeta: fetchMeta,
    estimateResources: estimateResources,
    harvest: harvest
  };

})();
