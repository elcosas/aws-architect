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
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const chartIdRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`);

  const extractSvgMarkup = () => {
    if (!svgCode || typeof svgCode !== 'string' || !svgCode.includes('<svg')) {
      return '';
    }

    const match = svgCode.match(/<svg[\s\S]*<\/svg>/i);
    return match ? match[0] : '';
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 300);
  };

  const handleDownloadSvg = () => {
    const svgMarkup = extractSvgMarkup();
    if (!svgMarkup) return;

    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(svgBlob, `${chartIdRef.current}.svg`);
    setIsDownloadMenuOpen(false);
  };

  const handleDownloadPng = async () => {
    const svgMarkup = extractSvgMarkup();
    if (!svgMarkup) return;

    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(svgBlob);

    try {
      await new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
          const width = Math.max(1, Math.floor(image.naturalWidth || 1200));
          const height = Math.max(1, Math.floor(image.naturalHeight || 700));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');

          if (!context) {
            reject(new Error('Unable to create canvas context for PNG export.'));
            return;
          }

          context.clearRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);

          canvas.toBlob(
            (pngBlob) => {
              if (!pngBlob) {
                reject(new Error('PNG export failed.'));
                return;
              }
              downloadBlob(pngBlob, `${chartIdRef.current}.png`);
              resolve();
            },
            'image/png',
            1,
          );
        };

        image.onerror = () => reject(new Error('Unable to render SVG to PNG.'));
        image.src = blobUrl;
      });
    } catch (error) {
      console.error('PNG export error:', error);
    } finally {
      URL.revokeObjectURL(blobUrl);
      setIsDownloadMenuOpen(false);
    }
  };

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

  const canExportDiagram = svgCode?.includes('<svg');

  return (
    <>
      {/* Regular Inline Chart */}
      <div className="mermaid-wrapper" title="Click diagram to expand">
        {canExportDiagram && (
          <div className="mermaid-actions">
            <button
              type="button"
              className="mermaid-copy-trigger"
              onClick={(event) => {
                event.stopPropagation();
                setIsDownloadMenuOpen(true);
              }}
              aria-label="Download diagram"
              title="Download diagram"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </button>
          </div>
        )}

        <div
          className="mermaid-canvas"
          dangerouslySetInnerHTML={{ __html: svgCode }}
          onClick={() => {
            if (canExportDiagram) {
              setIsDownloadMenuOpen(false);
              setIsFullscreen(true);
            }
          }}
        />
      </div>

      {isDownloadMenuOpen && (
        <div className="mermaid-download-overlay" onClick={() => setIsDownloadMenuOpen(false)}>
          <div className="mermaid-download-modal" role="dialog" aria-modal="true" aria-label="Choose diagram download format" onClick={(event) => event.stopPropagation()}>
            <h4>Download diagram</h4>
            <div className="mermaid-download-menu" role="menu" aria-label="Download diagram format">
              <button type="button" role="menuitem" onClick={handleDownloadSvg}>
                Download SVG
              </button>
              <button type="button" role="menuitem" onClick={handleDownloadPng}>
                Download PNG
              </button>
            </div>
            <button
              type="button"
              className="mermaid-download-cancel"
              onClick={() => setIsDownloadMenuOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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