import { useState } from 'react'
import './styles/App.css'

// Helper function to format the current time (e.g., "2:30 PM")
const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function App() {
  // Add a timestamp to the initial greeting
  const [messages, setMessages] = useState([
    { 
      role: 'assistant', 
      content: 'Hello! I am the AWS Architect Chatbot. How can I help you design your infrastructure today?',
      timestamp: getCurrentTime()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
  ];

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage = inputValue;
    
    // 1. Add user message with current time
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userMessage,
      timestamp: getCurrentTime()
    }]);
    
    setInputValue('');
    setIsLoading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); 
      
      // 2. Add assistant response with current time
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
        <main className="messages-area">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">{msg.content}</div>
              {/* Render the timestamp if it exists */}
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
        </main>
      ) : (
        <div className="home-screen">
          <h2>Hi there,</h2>
          <h1>Where should we start?</h1>
        </div>
      )}

      <footer className="input-area">
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