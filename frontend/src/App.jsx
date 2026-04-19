import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart'
import './styles/App.css'

const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Wired up to the real API Gateway!
const WS_URL = 'wss://evlh44mizl.execute-api.us-west-2.amazonaws.com/production';

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [ws, setWs] = useState(null);
  
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
  ];

  // --- WEBSOCKET SETUP ---
  useEffect(() => {
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
  }, []);

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

const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || !ws) return;

    // NEW: Check if the WebSocket is actually open and alive before doing anything!
    if (ws.readyState !== WebSocket.OPEN) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `**Connection Error:** I cannot reach the AWS backend. Please make sure the server is online.`, 
        timestamp: getCurrentTime() 
      }]);
      return;
    }
    
    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: getCurrentTime() }]);
    setInputValue('');
    setIsLoading(true);
    
    ws.send(JSON.stringify({ action: "sendMessage", userInput: userMessage, services: [] }));
  };

  const handleConfirmArchitecture = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: "I approve this architecture. Please deploy it.", 
      timestamp: getCurrentTime() 
    }]);
    setIsLoading(true);

    // Send a special action to the backend to trigger Step 7
    ws.send(JSON.stringify({ 
      action: "confirmArchitecture", 
      userInput: "approved" 
    }));
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
                {index === messages.length - 1 && msg.role === 'assistant' && msg.content.includes('```mermaid') && (
                  <div style={{ marginTop: '12px', textAlign: 'right' }}>
                    <button 
                      onClick={handleConfirmArchitecture} 
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
    </div>
  )
}

export default App