import React from 'react';

export default function DeployModal({
  isOpen,
  onClose,
  deployError,
  setDeployError,
  deployStatus,
  latestQuickCreateLink,
  latestExternalId,
  roleArn,
  setRoleArn,
  hasValidRoleArn,
  isFetchingExternalId,
  isDeploying,
  onConnectAwsAccount,
  onDeployServices
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h3>Connect AWS Account</h3>
        <p>
          Click below to open AWS CloudFormation Quick Create for the ChatbotConnect setup stack.
          This uses a backend-generated ExternalID and does not require sharing long-lived AWS keys.
        </p>
        
        {deployError && (
          <div className="credential-error">
            {deployError}
          </div>
        )}

        {deployStatus && (
          <div className="credential-error" style={{ borderColor: '#3fb950', color: '#3fb950', backgroundColor: 'rgba(63, 185, 80, 0.12)' }}>
            {deployStatus}
          </div>
        )}

        {latestQuickCreateLink && (
          <div className="form-group">
            <label>CloudFormation Setup Link (Fallback)</label>
            <a
              href={latestQuickCreateLink}
              target="cloudweaver-cfn-setup"
              rel="noreferrer"
              style={{ color: '#ffb84d', wordBreak: 'break-all', fontSize: '13px' }}
            >
              {latestQuickCreateLink}
            </a>
          </div>
        )}

        {latestExternalId && (
          <div className="form-group">
            <label>Latest ExternalID</label>
            <input
              type="text"
              className="modal-input"
              value={latestExternalId}
              readOnly
            />
          </div>
        )}

        <div className="form-group">
          <label>IAM Role ARN</label>
          <input
            type="text"
            className="modal-input"
            value={roleArn}
            onChange={(event) => {
              setRoleArn(event.target.value)
              if (deployError) {
                setDeployError('')
              }
            }}
            placeholder="arn:aws:iam::123456789012:role/ChatbotIntegrationRole-ChatbotConnect"
            aria-invalid={roleArn.trim().length > 0 && !hasValidRoleArn}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-confirm"
            onClick={onConnectAwsAccount}
            disabled={isFetchingExternalId}
          >
            {isFetchingExternalId ? 'Preparing Link...' : 'Open AWS Setup Link'}
          </button>
          <button
            type="button"
            className="btn-confirm"
            onClick={onDeployServices}
            disabled={isDeploying}
          >
            {isDeploying ? 'Deploying...' : 'Deploy Services'}
          </button>
        </div>
      </div>
    </div>
  );
}
