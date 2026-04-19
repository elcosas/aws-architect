import { memo, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let isMermaidInitialized = false;

const normalizeMermaidText = (source) => {
  if (!source || typeof source !== 'string') return '';

  let normalized = source.replace(/\r\n?/g, '\n').trim();

  // Some model outputs accidentally place multiple edge statements on one line
  // separated by large spaces, which breaks Mermaid parsing.
  normalized = normalized.replace(
    /(\]|\)|\}|"|')\s{2,}([A-Za-z_][\w-]*)\s*(-\.->|-->|==>)/g,
    '$1\n$2 $3',
  );

  return normalized;
};

const MermaidChart = ({ chart }) => {
  const [svgCode, setSvgCode] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartIdRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!isMermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'loose',
      });
      isMermaidInitialized = true;
    }

    let isCancelled = false;

    const renderChart = async () => {
      if (chart) {
        const normalizedChart = normalizeMermaidText(chart);
        const attempts = [chart, normalizedChart].filter((value, index, arr) => value && arr.indexOf(value) === index);

        try {
          for (let i = 0; i < attempts.length; i += 1) {
            try {
              // Have mermaid parse the text and give us back the SVG graphic
              const { svg } = await mermaid.render(`${chartIdRef.current}-${i}`, attempts[i]);
              if (!isCancelled) {
                const hasSyntaxErrorSvg = /Syntax error in text|mermaid version/i.test(svg);
                if (hasSyntaxErrorSvg) {
                  setSvgCode('<div style="color: #ff8a8a; font-weight: 600;">Error rendering diagram</div>');
                } else {
                  setSvgCode(svg);
                }
              }
              return;
            } catch (innerError) {
              if (i === attempts.length - 1) {
                throw innerError;
              }
            }
          }
        } catch (error) {
          console.error('Mermaid rendering error:', error);
          if (!isCancelled) {
            setSvgCode('<div style="color: #ff8a8a; font-weight: 600;">Error rendering diagram</div>');
          }
        }
      } else {
        setSvgCode('');
      }
    };

    renderChart();

    return () => {
      isCancelled = true;
    };
  }, [chart]);

  return (
    <>
      {/* Regular Inline Chart */}
      <div 
        className="mermaid-wrapper" 
        dangerouslySetInnerHTML={{ __html: svgCode }} 
        onClick={() => svgCode?.includes('<svg') && setIsFullscreen(true)}
        title="Click to expand"
      />

      {/* Fullscreen Overlay Modal */}
      {isFullscreen && (
        <div className="mermaid-fullscreen-overlay" onClick={() => setIsFullscreen(false)}>
          <div className="mermaid-fullscreen-content" onClick={(e) => e.stopPropagation()}>
            <button className="mermaid-close-btn" onClick={() => setIsFullscreen(false)}>
              ✕
            </button>
            <div dangerouslySetInnerHTML={{ __html: svgCode }} />
          </div>
        </div>
      )}
    </>
  );
};

export default memo(MermaidChart);