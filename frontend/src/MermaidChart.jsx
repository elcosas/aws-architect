import { memo, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let isMermaidInitialized = false;

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
        try {
          // Have mermaid parse the text and give us back the SVG graphic
          const { svg } = await mermaid.render(chartIdRef.current, chart);
          if (!isCancelled) {
            setSvgCode(svg);
          }
        } catch (error) {
          console.error("Mermaid rendering error:", error);
          if (!isCancelled) {
            setSvgCode(`<div style="color: red;">Error rendering diagram</div>`);
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
        onClick={() => svgCode && setIsFullscreen(true)}
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