import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart'
import './styles/App.css'

const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// ⚠️ IMPORTANT: Ask your teammate for the real API Gateway WebSocket URL and paste it here!
const WS_URL = 'wss://YOUR_API_GATEWAY_ID.execute-api.YOUR_[REGION.amazonaws.com/production](https://REGION.amazonaws.com/production)';

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  
  // NEW: We need a state to hold the active WebSocket connection
  const [ws, setWs] = useState(null);
  
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
  ];

  // NEW: Initialize the WebSocket connection when the app loads
  useEffect(() => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      console.log('✅ WebSocket Connected!');
    };

    // This runs whenever your Lambda/Bedrock sends a message back!
    socket.onmessage = (event) => {
      setIsLoading(false); // Turn off the typing indicator
      
      try {
        const data = JSON.parse(event.data);

        // Scenario 1: Success! We got Mermaid code from the backend
        if (data.mermaid_code) {
          // We wrap their raw mermaid code in markdown backticks so our parser catches it
          const botResponse = `Here is your architecture:\n\n\`\`\`mermaid\n${data.mermaid_code}\n\`\`\``;
          
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            content: botResponse, 
            timestamp: getCurrentTime() 
          }]);
        } 
        // Scenario 2: Something went wrong on the backend
        else if (data.error) {
          setMessages(prev => [...prev, { 
            role: 'assistant', 
            content: `**Backend Error:** ${data.error}`, 
            timestamp: getCurrentTime() 
          }]);
        }
      } catch (err) {
        console.error("Failed to parse incoming WebSocket message:", err);
      }
    };

    socket.onerror = (error) => {
      console.error("❌ WebSocket Error:", error);
      setIsLoading(false);
    };

    // Save the socket in state so we can use it to send messages later
    setWs(socket);

    // Cleanup: Close the connection if the user leaves the page
    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (!isUserScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleScroll = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsUserScrolledUp(distanceFromBottom > 50);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsUserScrolledUp(false);
  };

  // CHANGED: We now send the real JSON payload to the WebSocket
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || !ws) return;

    const userMessage = inputValue;
    
    // Add user message to screen
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: getCurrentTime() }]);
    setInputValue('');
    setIsLoading(true);

    // Construct the exact JSON payload your teammate requested
    const requestPayload = {
      action: "sendMessage",
      userInput: userMessage,
      services: [] // Leaving empty for now, can be populated if you build a UI for selecting services
    };

    // Fire it off to API Gateway!
    ws.send(JSON.stringify(requestPayload));
  }

  const handleServiceClick = (service) => {
    setInputValue(`Help me configure ${service}`);
  }

  return (
    <div className="chat-container">
      
      {messages.length > 0 && (
        <header className="chat-header">
          <h1>AWS Architect</h1>
        </header>
      )}

      {messages.length > 0 ? (
        <main className="messages-area" ref={chatContainerRef} onScroll={handleScroll}>
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">
                
                <ReactMarkdown
                  components={{
                    code(props) {
                      const {children, className, node, ...rest} = props
                      const match = /language-(\w+)/.exec(className || '')
                      if (match && match[1] === 'mermaid') {
                        return <MermaidChart chart={String(children).replace(/\n$/, '')} />
                      }
                      return <code {...rest} className={className}>{children}</code>
                    }
                  }}
                >
                  {msg.content}
                </ReactMarkdown>

              </div>
              {msg.timestamp && (
                <div className="message-timestamp">{msg.timestamp}</div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="message assistant">
              <div className="message-content typing-indicator">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </main>
      ) : (
        <div className="home-screen">
          <h2>Hi there,</h2>
          <h1>Where should we start?</h1>
        </div>
      )}

      <footer className="input-area">
        {isUserScrolledUp && messages.length > 0 && (
          <button className="scroll-to-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline points="19 12 12 19 5 12"></polyline>
            </svg>
          </button>
        )}
        <form className="input-form" onSubmit={handleSendMessage}>
          <input type="text" className="chat-input" placeholder="Ask AWS Architect" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isLoading} />
          <button type="submit" className="send-button" disabled={isLoading || !inputValue.trim()}>Send</button>
        </form>
        <div className="suggestion-chips">
          {awsServices.map(service => (
            <button key={service} className="chip-button" onClick={() => handleServiceClick(service)}>{service}</button>
          ))}
        </div>
      </footer>
    </div>
  )
}

export default App