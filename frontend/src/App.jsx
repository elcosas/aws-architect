import { useState, useRef, useEffect } from 'react'
import './styles/App.css'

// Helper function to format the current time
const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
  ];

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

  // NEW: Function to force scroll to bottom and reset the state
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsUserScrolledUp(false);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage = inputValue;
    
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userMessage,
      timestamp: getCurrentTime()
    }]);
    
    setInputValue('');
    setIsLoading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); 
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I've processed your request using our connected AWS architecture. What would you like to build next?",
        timestamp: getCurrentTime()
      }]);
    } catch (error) {
      console.error("Error talking to backend:", error);
    } finally {
      setIsLoading(false);
    }
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
              <div className="message-content">{msg.content}</div>
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

      {/* Input Area, Service Buttons, and Floating Arrow */}
      <footer className="input-area">
        
        {/* WE MOVED THE BUTTON INSIDE THE FOOTER */}
        {isUserScrolledUp && messages.length > 0 && (
          <button 
            className="scroll-to-bottom" 
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <polyline points="19 12 12 19 5 12"></polyline>
            </svg>
          </button>
        )}

        <form className="input-form" onSubmit={handleSendMessage}>
          <input
            type="text"
            className="chat-input"
            placeholder="Ask AWS Architect"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
          />
          <button type="submit" className="send-button" disabled={isLoading || !inputValue.trim()}>
            Send
          </button>
        </form>

        <div className="suggestion-chips">
          {awsServices.map(service => (
            <button 
              key={service} 
              className="chip-button"
              onClick={() => handleServiceClick(service)}
            >
              {service}
            </button>
          ))}
        </div>
      </footer>

    </div>
  )
}

export default App