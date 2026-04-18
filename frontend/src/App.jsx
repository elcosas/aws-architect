import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart' // NEW: Import our chart component
import './styles/App.css'

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsUserScrolledUp(false);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: getCurrentTime() }]);
    setInputValue('');
    setIsLoading(true);

    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); 
      
      // CHANGED: We added a real Mermaid flowchart to the bot's response!
      const botResponse = `I've processed your request. Here is the **AWS Serverless Architecture**:

\`\`\`mermaid
graph TD;
    Client-->|HTTPS| APIGateway;
    APIGateway-->|Triggers| Lambda;
    Lambda-->|Reads/Writes| DynamoDB;
    Lambda-->|Stores Files| S3;
\`\`\`

Let me know if you want to tweak this!`;

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: botResponse,
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
              <div className="message-content">
                
                {/* CHANGED: We tell ReactMarkdown how to handle <code> tags */}
                <ReactMarkdown
                  components={{
                    code(props) {
                      const {children, className, node, ...rest} = props
                      // Check if the code block is labeled as "mermaid"
                      const match = /language-(\w+)/.exec(className || '')
                      if (match && match[1] === 'mermaid') {
                        // If it is, render our Chart instead of text!
                        return <MermaidChart chart={String(children).replace(/\n$/, '')} />
                      }
                      // Otherwise, just render it as a normal gray code block
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