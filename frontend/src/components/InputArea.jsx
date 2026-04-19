import React from 'react';

const InputArea = ({
  inputAreaRef,
  inputAreaHeight,
  controlsScale,
  isUserScrolledUp,
  messages,
  scrollToBottom,
  modeMenuRef,
  isTestMode,
  setIsHelpModalOpen,
  setIsModeMenuOpen,
  isModeMenuOpen,
  handleModeSelect,
  setIsMobileServicesOpen,
  isMobileServicesOpen,
  handleSendMessage,
  inputValue,
  setInputValue,
  isLoading,
  awsServices,
  activeServices,
  selectedServices,
  handleServiceToggle,
  setActiveServiceInfo,
}) => {
  return (
    <footer
      ref={inputAreaRef}
      className="input-area"
      style={{
        ...(inputAreaHeight ? { height: `${inputAreaHeight}px` } : {}),
        '--controls-scale': controlsScale,
      }}
    >
      {isUserScrolledUp && messages.length > 0 && (
        <button className="scroll-to-bottom" onClick={scrollToBottom}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>
      )}
      <div className="mode-selector-row" ref={modeMenuRef}>
        <span className={`active-mode-indicator ${isTestMode ? 'test' : 'dev'}`}>
            {isTestMode ? '● Test Mode Active' : '● Default Mode Active'}
        </span>
        <button
          type="button"
          className="guide-help-button"
          aria-label="How to use Cloud Weaver"
          onClick={() => setIsHelpModalOpen(true)}
        >
          ?
        </button>
        <button
          type="button"
          className="mode-gear-button"
          onClick={() => setIsModeMenuOpen((prev) => !prev)}
          aria-label="Open mode selector"
          aria-expanded={isModeMenuOpen}
        >
          ⚙
        </button>
        {isModeMenuOpen && (
          <div className="mode-dropdown">
            <button
              type="button"
              className={`mode-option test ${isTestMode ? 'selected' : ''}`}
              onClick={() => handleModeSelect('test')}
            >
              Test Mode
            </button>
            <button
              type="button"
              className={`mode-option dev ${!isTestMode ? 'selected' : ''}`}
              onClick={() => handleModeSelect('dev')}
            >
              Default Mode
            </button>
          </div>
        )}
        <button
          type="button"
          className="services-toggle-button"
          onClick={() => setIsMobileServicesOpen((prev) => !prev)}
          aria-label="Toggle AWS services panel"
          aria-expanded={isMobileServicesOpen}
        >
          {isMobileServicesOpen ? '▼ Services' : '▲ Services'}
        </button>
      </div>
      <form className="input-form" onSubmit={handleSendMessage}>
        <textarea
          className="chat-input"
          rows={1}
          placeholder="Ask Cloud Weaver"
          value={inputValue}
          onInput={(e) => {
            setInputValue(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = e.target.scrollHeight + 'px';
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage(e);
            }
          }}
          disabled={isLoading}
        />
        <button type="submit" className="send-button" disabled={isLoading || !inputValue.trim()}>Send</button>
      </form>
      <div className={`services-panel-container ${isMobileServicesOpen ? 'is-open' : ''}`}>
        <div className="services-panel" aria-label="AWS services in current diagram">
          <div className={`services-grid ${awsServices.length === 7 ? 'services-grid--seven' : ''}`}>
            {awsServices.map(service => {
              const isUsed = activeServices.has(service)
              const isSelected = selectedServices.includes(service)
              return (
                <div key={service} className="service-chip-row">
                  <button
                    type="button"
                    className={`chip-button ${isUsed ? 'chip-button--used' : 'chip-button--unused'} ${isSelected ? 'chip-button--selected' : ''}`}
                    onClick={() => handleServiceToggle(service)}
                    aria-pressed={isSelected}
                  >
                    <span className={`service-status-dot ${isUsed ? 'used' : 'unused'}`} aria-hidden="true" />
                    <span className="service-name">{service}</span>
                  </button>

                  <button
                    type="button"
                    className="service-info-trigger"
                    aria-label={`Learn about ${service}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setActiveServiceInfo(service)
                    }}
                  >
                    i
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </footer>
  );
};

export default InputArea;
