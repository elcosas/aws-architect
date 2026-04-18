import { useEffect, useState } from 'react';
import mermaid from 'mermaid';

// Tell mermaid to use a dark theme to match our app
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
});

const MermaidChart = ({ chart }) => {
  const [svgCode, setSvgCode] = useState('');

  useEffect(() => {
    const renderChart = async () => {
      if (chart) {
        try {
          // Generate a unique ID for the chart
          const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
          // Have mermaid parse the text and give us back the SVG graphic
          const { svg } = await mermaid.render(id, chart);
          setSvgCode(svg);
        } catch (error) {
          console.error("Mermaid rendering error:", error);
          setSvgCode(`<div style="color: red;">Error rendering diagram</div>`);
        }
      }
    };
    renderChart();
  }, [chart]);

  // dangerouslySetInnerHTML is safe here because we trust the Mermaid library's output
  return (
    <div className="mermaid-wrapper" dangerouslySetInnerHTML={{ __html: svgCode }} />
  );
};

export default MermaidChart;