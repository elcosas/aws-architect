import { memo, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let isMermaidInitialized = false;

const MermaidChart = ({ chart }) => {
  const [svgCode, setSvgCode] = useState('');
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

  // dangerouslySetInnerHTML is safe here because we trust the Mermaid library's output
  return (
    <div className="mermaid-wrapper" dangerouslySetInnerHTML={{ __html: svgCode }} />
  );
};

export default memo(MermaidChart);