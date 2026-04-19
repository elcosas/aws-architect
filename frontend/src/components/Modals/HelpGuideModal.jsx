import React from 'react';
import { createPortal } from 'react-dom';

export default function HelpGuideModal({ isOpen, onClose }) {
  if (!isOpen || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="guide-overlay" onClick={onClose}>
      <div className="guide-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="How to use Cloud Weaver">
        <button
          type="button"
          className="guide-close"
          aria-label="Close guide"
          onClick={onClose}
        >
          ✕
        </button>

        <h3>How to use Cloud Weaver</h3>

        <p className="guide-section-title">1) Start with basic prompts + memory</p>
        <ol>
          <li>Describe what you want in plain language (for example: workload type, scale, security, and region).</li>
          <li>Refine with follow-ups like “make it cheaper,” “add HA,” or “use private subnets.”</li>
          <li>The current session remembers prior context, so you can iteratively improve one architecture over multiple prompts.</li>
        </ol>

        <p className="guide-section-title">2) Read the Mermaid diagram</p>
        <ol>
          <li>Each node is an AWS service/component in the design.</li>
          <li>Arrows/links represent request flow, data flow, or control relationships.</li>
          <li>Read left-to-right (entry to backend/data), then validate security boundaries and data persistence points.</li>
        </ol>

        <p className="guide-section-title">3) Deploy with guided confirmation</p>
        <ol>
          <li>Click <strong>Confirm &amp; Deploy Architecture</strong> under the generated diagram.</li>
          <li>First confirmation is a browser confirmation step.</li>
          <li>Second confirmation opens the <strong>Connect AWS Account</strong> flow where you can:</li>
        </ol>
        <ul>
          <li>Use <strong>Open AWS Setup Link</strong> to launch CloudFormation Quick Create.</li>
          <li>Provide your <strong>IAM Role ARN</strong> (example format shown in the modal).</li>
          <li>Click <strong>Generate CloudFormation</strong> to produce the deployable template.</li>
        </ul>
      </div>
    </div>,
    document.body
  );
}
