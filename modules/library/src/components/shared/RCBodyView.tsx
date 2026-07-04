/**
 * Read-only body display for rule/concept text.
 * Monospace, whitespace-pre-wrap.
 */

export interface RCBodyViewProps {
  text: string;
}

export function RCBodyView({ text }: RCBodyViewProps) {
  return (
    <pre
      style={{
        margin: 0,
        fontFamily: 'var(--ap-font-mono)',
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--ap-text)',
        background: 'transparent',
        padding: 0,
      }}
    >
      {text}
    </pre>
  );
}
