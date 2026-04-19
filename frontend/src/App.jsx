import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart'
import './styles/App.css'

const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  
  // Modal States
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [awsCredentials, setAwsCredentials] = useState({
    accessKeyId: '',
    secretAccessKey: ''
  });

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
  ];

  // --- UI LOGIC ---
  useEffect(() => {
    if (!isUserScrolledUp) { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }
  }, [messages, isLoading]);

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsUserScrolledUp(distance > 50);
  };

  const scrollToBottom = () => { 
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
    setIsUserScrolledUp(false); 
  };

  // 1. FAKED SEND MESSAGE FLOW
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    
    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: getCurrentTime() }]);
    setInputValue('');
    setIsLoading(true);
    
    // FAKE THE BACKEND DELAY
    setTimeout(() => {
      setIsLoading(false);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "Here is the architecture based on your request:\n\n```mermaid\ngraph LR\nUser --> API[API Gateway]\nAPI --> Lambda[AWS Lambda]\nLambda --> DB[(DynamoDB)]\n```", 
        timestamp: getCurrentTime() 
      }]);
    }, 1500);
  };

  // 2. FAKED DEPLOY FLOW FROM POPUP
  const handleFinalDeploy = (e) => {
    e.preventDefault();
    setIsDeployModalOpen(false); // Close the popup
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: "I approve this architecture. Please deploy it using my provided AWS Credentials.", 
      timestamp: getCurrentTime() 
    }]);
    setIsLoading(true);

    // FAKE THE FINAL BACKEND DEPLOYMENT RESPONSE
    setTimeout(() => {
      setIsLoading(false);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "🚀 **Deployment Initiated!** Assuming role and sending CloudFormation templates to AWS...", 
        timestamp: getCurrentTime() 
      }]);
    }, 2000);

    setAwsCredentials({ accessKeyId: '', secretAccessKey: '' });
  };

  const handleServiceClick = (service) => setInputValue(`Help me configure ${service}`);

  return (
    <div className="chat-container">
      {messages.length > 0 && <header className="chat-header"><h1>AWS Architect</h1></header>}
      
      {messages.length > 0 ? (
        <main className="messages-area" ref={chatContainerRef} onScroll={handleScroll}>
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">
                <ReactMarkdown components={{
                  code(props) {
                    const {children, className, node, ...rest} = props
                    const match = /language-(\w+)/.exec(className || '')
                    return match && match[1] === 'mermaid' 
                      ? <MermaidChart chart={String(children).replace(/\n$/, '')} />
                      : <code {...rest} className={className}>{children}</code>
                  }
                }}>{msg.content}</ReactMarkdown>
                
                {/* Opens the Popup instead of sending immediately */}
                {index === messages.length - 1 && msg.role === 'assistant' && msg.content.includes('```mermaid') && (
                  <div style={{ marginTop: '12px', textAlign: 'right' }}>
                    <button 
                      onClick={() => setIsDeployModalOpen(true)} 
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
        <div className="home-screen"><h2>Hi there,</h2><h1>Where should we start?</h1></div>
      )}
      
      <footer className="input-area">
        {isUserScrolledUp && messages.length > 0 && (
          <button className="scroll-to-bottom" onClick={scrollToBottom}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>
        )}
        <form className="input-form" onSubmit={handleSendMessage}>
          <input type="text" className="chat-input" placeholder="Ask AWS Architect" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isLoading} />
          <button type="submit" className="send-button" disabled={isLoading || !inputValue.trim()}>Send</button>
        </form>
        <div className="suggestion-chips">
          {awsServices.map(service => <button key={service} className="chip-button" onClick={() => handleServiceClick(service)}>{service}</button>)}
        </div>
      </footer>

      {/* The AWS Credentials Popup Modal */}
      {isDeployModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Deploy Architecture</h3>
            <p>Please provide your AWS credentials so we can assume the role and deploy the CloudFormation template.</p>
            
            <form onSubmit={handleFinalDeploy}>
              <div className="form-group">
                <label>AWS Access Key ID</label>
                <input 
                  type="text" 
                  className="modal-input" 
                  required
                  value={awsCredentials.accessKeyId}
                  onChange={(e) => setAwsCredentials({...awsCredentials, accessKeyId: e.target.value})}
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
                  onChange={(e) => setAwsCredentials({...awsCredentials, secretAccessKey: e.target.value})}
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" 
                />
              </div>
              
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setIsDeployModalOpen(false)}>Cancel</button>
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