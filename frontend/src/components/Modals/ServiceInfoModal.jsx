import React from 'react';
import { createPortal } from 'react-dom';

export default function ServiceInfoModal({ activeServiceInfo, serviceDetails, onClose }) {
  if (!activeServiceInfo || !serviceDetails || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="service-info-overlay" onClick={onClose}>
      <div className="service-info-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${activeServiceInfo} details`}>
        <button
          type="button"
          className="service-info-close"
          aria-label="Close service details"
          onClick={onClose}
        >
          ✕
        </button>

        <h3>{activeServiceInfo}</h3>

        <p className="service-info-section-title">General use</p>
        <p>{serviceDetails.generalUse}</p>

        <div className="service-pros-cons-grid">
          <div className="service-pros-cons-column">
            <p className="service-info-section-title service-info-section-title--pros">Pros</p>
            <ul>
              {serviceDetails.pros.map((item) => (
                <li key={`${activeServiceInfo}-pro-${item}`}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="service-pros-cons-column">
            <p className="service-info-section-title service-info-section-title--cons">Cons</p>
            <ul>
              {serviceDetails.cons.map((item) => (
                <li key={`${activeServiceInfo}-con-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <p className="service-info-section-title">Commonly used with</p>
        <p>{serviceDetails.commonlyUsedWith.join(', ')}</p>

        <div className="service-info-docs">
          <a
            href={serviceDetails.docsUrl}
            target="_blank"
            rel="noreferrer"
          >
            🔗 Official AWS documentation
          </a>
        </div>
      </div>
    </div>,
    document.body
  );
}
