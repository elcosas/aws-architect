import { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart'
import './styles/App.css'

const DEFAULT_TEST_MODE = import.meta.env.VITE_TEST_MODE !== 'false'
const WS_URL =
  import.meta.env.VITE_WS_URL || 'wss://9vihcpxj86.execute-api.us-west-2.amazonaws.com/dev'

const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [ws, setWs] = useState(null);
  const [isTestMode, setIsTestMode] = useState(DEFAULT_TEST_MODE);
  
  // Modal States
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [credentialError, setCredentialError] = useState(''); 
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [awsCredentials, setAwsCredentials] = useState({
    accessKeyId: '',
    secretAccessKey: ''
  });

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const modeMenuRef = useRef(null);

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
  ];

  useEffect(() => {
    if (isTestMode) {
      setWs(null);
      setIsLoading(false);
      console.log('🧪 Running in TEST MODE. WebSocket is disabled.');
      return; 
    }

    const socket = new WebSocket(WS_URL);
    
    socket.onopen = () => console.log('✅ WebSocket Connected!');
    
    socket.onmessage = (event) => {
      setIsLoading(false);
      try {
        const data = JSON.parse(event.data);
        if (data.mermaid_code) {
          const botResponse = `Here is your architecture:\n\n\`\`\`mermaid\n${data.mermaid_code}\n\`\`\``;
          setMessages(prev => [...prev, { role: 'assistant', content: botResponse, timestamp: getCurrentTime() }]);
        } else if (data.error) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**Backend Error:** ${data.error}`, timestamp: getCurrentTime() }]);
        } else if (data.message) {
          setMessages(prev => [...prev, { role: 'assistant', content: data.message, timestamp: getCurrentTime() }]);
        }
      } catch (err) { 
        console.error("Message parse error:", err); 
      }
    };

    socket.onerror = (error) => {
      console.error("❌ WebSocket Error:", error);
      setIsLoading(false);
    };

    socket.onclose = () => {
      console.warn("⚠️ WebSocket Disconnected!");
      setIsLoading(false); 
    };

    setWs(socket);
    return () => socket.close();
  }, [isTestMode]);

  // --- UI LOGIC ---
  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [messages, isLoading, isUserScrolledUp]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target)) {
        setIsModeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nextIsScrolledUp = distanceFromBottom > 50;
    setIsUserScrolledUp((prev) => (prev === nextIsScrolledUp ? prev : nextIsScrolledUp));
  };

  const scrollToBottom = () => { 
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
    setIsUserScrolledUp(false); 
  };

  // --- SEND MESSAGE (HANDLES BOTH MODES) ---
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: getCurrentTime() }]);
    setInputValue('');
    setIsLoading(true);

    if (isTestMode) {
      // 🧪 Fake the backend response
      setTimeout(() => {
        setIsLoading(false);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: "Here is the architecture based on your request:\n\n```mermaid\ngraph LR\nUser --> API[API Gateway]\nAPI --> Lambda[AWS Lambda]\nLambda --> DB[(DynamoDB)]\n```", 
          timestamp: getCurrentTime() 
        }]);
      }, 1500);
    } else {
      // 🌐 Live backend request
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setIsLoading(false);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `**Connection Error:** I cannot reach the AWS backend at \`${WS_URL}\`. If you are developing locally and want mocked responses, enable test mode with \`VITE_TEST_MODE=true\`.`, 
          timestamp: getCurrentTime() 
        }]);
        return;
      }
      ws.send(JSON.stringify({ action: "sendMessage", userInput: userMessage, services: [] }));
    }
  };

  // --- INITIATE DEPLOY (ASK "ARE YOU SURE?" FIRST) ---
  const handleInitiateDeploy = () => {
    const isConfirmed = window.confirm("Are you sure you want to proceed to deployment? This will eventually create live resources in your AWS account and may incur charges.");
    
    if (isConfirmed) {
      setIsDeployModalOpen(true);
    }
  };

  // --- DEPLOY FLOW (HANDLES BOTH MODES) ---
  const handleFinalDeploy = (e) => {
    e.preventDefault();
    
    // 1. REGEX VALIDATION
    const accessKeyRegex = /^(AKIA|ASIA)[A-Z0-9]{16}$/;
    const secretKeyRegex = /^[A-Za-z0-9/+=]{40}$/;

    if (!accessKeyRegex.test(awsCredentials.accessKeyId)) {
      setCredentialError('Invalid Access Key ID. Must be 20 characters and start with AKIA or ASIA.');
      return; 
    }

    if (!secretKeyRegex.test(awsCredentials.secretAccessKey)) {
      setCredentialError('Invalid Secret Access Key. Must be exactly 40 characters long.');
      return; 
    }

    // Validation passed!
    setCredentialError('');
    setIsDeployModalOpen(false); 
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: "I approve this architecture. Please deploy it using my provided AWS Credentials.", 
      timestamp: getCurrentTime() 
    }]);
    setIsLoading(true);

    if (isTestMode) {
      // 🧪 Fake the deployment response
      setTimeout(() => {
        setIsLoading(false);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: "🚀 **Deployment Initiated!** Assuming role and sending CloudFormation templates to AWS...", 
          timestamp: getCurrentTime() 
        }]);
      }, 2000);
    } else {
      // 🌐 Live deployment request
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setIsLoading(false);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `**Connection Error:** Lost connection to AWS backend.`, 
          timestamp: getCurrentTime() 
        }]);
        return;
      }
      ws.send(JSON.stringify({ 
        action: "generateCloudFormation", 
        userInput: "approved architecture",
        approvedDiagram: "",
        services: [],
        credentials: awsCredentials
      }));
    }

    setAwsCredentials({ accessKeyId: '', secretAccessKey: '' });
  };

  const handleCloseModal = () => {
    setIsDeployModalOpen(false);
    setCredentialError('');
  };

  const handleServiceClick = (service) => setInputValue(`Help me configure ${service}`);

  const resetUiForModeChange = () => {
    setMessages([]);
    setInputValue('');
    setIsLoading(false);
    setIsUserScrolledUp(false);
    setCredentialError('');
    setIsModeMenuOpen(false);
    setIsDeployModalOpen(false);
    setAwsCredentials({ accessKeyId: '', secretAccessKey: '' });
  };

  const handleModeSelect = (mode) => {
    const nextIsTestMode = mode === 'test';
    setIsModeMenuOpen(false);

    if (nextIsTestMode === isTestMode) return;

    resetUiForModeChange();
    setIsTestMode(nextIsTestMode);
  };

  const markdownComponents = useMemo(
    () => ({
      code(props) {
        const { children, className, ...rest } = props
        const match = /language-(\w+)/.exec(className || '')
        if (match && match[1] === 'mermaid') {
          return <MermaidChart chart={String(children).replace(/\n$/, '')} />
        }
        return (
          <code {...rest} className={className}>
            {children}
          </code>
        )
      },
    }),
    [],
  )

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>AWS Architect</h1>
      </header>
      
      {messages.length > 0 ? (
        <main className="messages-area" ref={chatContainerRef} onScroll={handleScroll}>
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">
                <ReactMarkdown components={markdownComponents}>
                  {msg.content}
                </ReactMarkdown>

                {index === messages.length - 1 && msg.role === 'assistant' && msg.content.includes('```mermaid') && (
                  <div style={{ marginTop: '12px', textAlign: 'right' }}>
                    {/* CHANGED: Now calls handleInitiateDeploy instead of opening modal directly */}
                    <button 
                      onClick={handleInitiateDeploy} 
                      style={{
                        backgroundColor: '#238636', 
                        color: 'white', 
                        border: 'none', 
                        padding: '8px 16px', 
                        borderRadius: '4px', 
                        cursor: 'pointer',
                        fontWeight: 'bold'
                      }}
                    >
                      Confirm & Deploy Architecture
                    </button>
                  </div>
                )}
              </div>
              {msg.timestamp && <div className="message-timestamp">{msg.timestamp}</div>}
            </div>
          ))}
          {isLoading && <div className="message assistant"><div className="message-content typing-indicator"><span className="dot"></span><span className="dot"></span><span className="dot"></span></div></div>}
          <div ref={messagesEndRef} />
        </main>
      ) : (
        <div className="home-screen">
          <h2>Hi there,</h2>
           <h1>Where should we start?</h1>
          <p className="home-screen-copy">
            Use test mode to preview the UI with mocked responses or switch to live mode to talk to the backend.
          </p>
        </div>
      )}
      
      <footer className="input-area">
        {isUserScrolledUp && messages.length > 0 && (
          <button className="scroll-to-bottom" onClick={scrollToBottom}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>
        )}
        <div className="mode-selector-row" ref={modeMenuRef}>
          <span className={`active-mode-indicator ${isTestMode ? 'test' : 'dev'}`}>
            {isTestMode ? '● Test Mode Active' : '● Dev Mode Active'}
          </span>
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
                Dev Mode
              </button>
            </div>
          )}
        </div>
        <form className="input-form" onSubmit={handleSendMessage}>
          <input type="text" className="chat-input" placeholder="Ask AWS Architect" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isLoading} />
          <button type="submit" className="send-button" disabled={isLoading || !inputValue.trim()}>Send</button>
        </form>
        <div className="suggestion-chips">
          {awsServices.map(service => <button key={service} className="chip-button" onClick={() => handleServiceClick(service)}>{service}</button>)}
        </div>
      </footer>

      {isDeployModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Deploy Architecture</h3>
            <p>Please provide your AWS credentials so we can assume the role and deploy the CloudFormation template.</p>
            
            {credentialError && (
              <div className="credential-error">
                {credentialError}
              </div>
            )}
            
            <form onSubmit={handleFinalDeploy}>
              <div className="form-group">
                <label>AWS Access Key ID</label>
                <input 
                  type="text" 
                  className="modal-input" 
                  required
                  value={awsCredentials.accessKeyId}
                  onChange={(e) => {
                    setAwsCredentials({...awsCredentials, accessKeyId: e.target.value});
                    setCredentialError('');
                  }}
                  placeholder="AKIAIOSFODNN7EXAMPLE" 
                />
              </div>
              <div className="form-group">
                <label>AWS Secret Access Key</label>
                <input 
                  type="password" 
                  className="modal-input" 
                  required
                  value={awsCredentials.secretAccessKey}
                  onChange={(e) => {
                    setAwsCredentials({...awsCredentials, secretAccessKey: e.target.value});
                    setCredentialError('');
                  }}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" 
                />
              </div>
              
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={handleCloseModal}>Cancel</button>
                <button type="submit" className="btn-confirm">Deploy to AWS</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App