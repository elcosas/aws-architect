import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart'
import HelpGuideModal from './components/Modals/HelpGuideModal'
import ServiceInfoModal from './components/Modals/ServiceInfoModal'
import DeployModal from './components/Modals/DeployModal'
import InputArea from './components/InputArea'
import './styles/App.css'

const DEFAULT_TEST_MODE = String(import.meta.env.VITE_TEST_MODE || '').toLowerCase() === 'true'
const WS_URL =
  import.meta.env.VITE_WS_URL || 'wss://9vihcpxj86.execute-api.us-west-2.amazonaws.com/dev'
const SESSION_STORAGE_KEY = 'aws-architect.sessionID'
const THEME_STORAGE_KEY = 'aws-architect.theme'
const ASSISTANT_MERMAID_SEPARATOR = '\n\n<<<MERMAID_DIAGRAM>>>\n\n'
const SETUP_TEMPLATE_URL = 'https://cloudweaver-user-templates.s3.us-west-2.amazonaws.com/cloudformation-user-setup.yml'
const IAM_ROLE_ARN_PATTERN = /^arn:aws(-[a-z]+)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/
const DEFAULT_DEPLOY_REGION = 'us-east-1'
const DEFAULT_DEPLOY_STACK_NAME_PREFIX = 'CloudWeaverStack'
const DEFAULT_SETUP_STACK_NAME = 'ChatbotConnect'
const HOME_ROTATING_VERBS = ['building', 'architecting', 'developing', 'scaling', 'optimizing', 'deploying']

const getStoredTheme = () => {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
    return storedTheme === 'light' ? 'light' : 'dark'
  } catch (error) {
    console.warn('Unable to read theme from localStorage:', error)
    return 'dark'
  }
}

const storeTheme = (theme) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch (error) {
    console.warn('Unable to write theme to localStorage:', error)
  }
}

const getStoredSessionId = () => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch (error) {
    console.warn('Unable to read sessionID from localStorage:', error)
    return null
  }
}

const storeSessionId = (sessionId) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    if (sessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId)
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch (error) {
    console.warn('Unable to write sessionID to localStorage:', error)
  }
}

const generateLocalSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const getCurrentTime = () => {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const SERVICE_MATCHERS = {
  'Amazon Bedrock': /\bbedrock\b|br\b/i,
  'AWS Lambda': /\blambda\b|\bfn\b/i,
  'Amazon S3': /\bs3\b|simple\s+storage|bucket/i,
  'API Gateway': /api\s*gateway|apigateway|\bapigw\b|\bgateway\b/i,
  'CloudFront': /\bcloudfront\b|\bcf\b/i,
  'CloudFormation': /\bcloudformation\b|\bcfn\b/i,
  'DynamoDB': /\bdynamodb\b|\bddb\b/i,
  'AWS IAM': /\biam\b|identity\s+and\s+access\s+management|identity\s+center|sts/i,
};

const SERVICE_INFO = {
  'Amazon Bedrock': {
    generalUse: 'Amazon Bedrock helps you add production-grade generative AI to your application without managing GPU servers or model hosting pipelines. You can use it for chat assistants, architecture generation, summarization, classification, and content drafting while keeping your app in AWS-native workflows. For teams building quickly, Bedrock reduces operational complexity so you can focus on product logic, prompt quality, and user experience instead of infrastructure engineering.',
    pros: ['No model servers to manage', 'Multiple model choices in one place', 'Fast path from prototype to production', 'Strong AWS security and IAM integration', 'Useful for chat, generation, and summarization'],
    cons: ['Costs can rise with heavy token usage', 'Prompt design quality affects output quality', 'Model latency can vary by workload', 'Need guardrails for sensitive outputs', 'Regional/model availability may differ'],
    commonlyUsedWith: ['AWS Lambda', 'API Gateway', 'DynamoDB', 'Amazon S3', 'AWS IAM'],
    docsUrl: 'https://docs.aws.amazon.com/bedrock/',
  },
  'AWS Lambda': {
    generalUse: 'AWS Lambda is a serverless compute service that runs your code on demand in response to API calls, events, or scheduled triggers. It is ideal for backend endpoints, integration glue, automation jobs, and event-driven pipelines where you want fast iteration and minimal operations work. In this project, Lambda is the core backend brain that receives WebSocket messages, orchestrates Bedrock calls, validates output, and manages session-aware chat behavior.',
    pros: ['No servers to patch or maintain', 'Automatic scaling for burst traffic', 'Pay only when code runs', 'Great fit with API Gateway and events', 'Speeds up backend delivery for small teams'],
    cons: ['Cold starts can affect response time', 'Runtime and timeout limits apply', 'Large dependencies can be tricky', 'State is ephemeral between invocations', 'Observability can be harder across many functions'],
    commonlyUsedWith: ['API Gateway', 'DynamoDB', 'Amazon S3', 'CloudFormation', 'AWS IAM'],
    docsUrl: 'https://docs.aws.amazon.com/lambda/',
  },
  'Amazon S3': {
    generalUse: 'Amazon S3 is object storage used for static web assets, media files, artifacts, logs, backups, and generated outputs. It is highly durable, easy to scale, and works extremely well with CloudFront to deliver frontend content globally with low latency. For modern apps, S3 often becomes the central storage layer for immutable files and deployment artifacts, while lifecycle policies help keep long-term storage costs predictable.',
    pros: ['Extremely durable object storage', 'Scales to massive file counts', 'Multiple storage classes for cost control', 'Excellent with CloudFront and static hosting', 'Simple event integration with other AWS services'],
    cons: ['Not meant for relational queries', 'Permissions can be risky if misconfigured', 'Request and transfer pricing needs monitoring', 'Object key design impacts organization', 'Versioning/lifecycle policies require planning'],
    commonlyUsedWith: ['CloudFront', 'AWS Lambda', 'CloudFormation', 'AWS IAM', 'API Gateway'],
    docsUrl: 'https://docs.aws.amazon.com/s3/',
  },
  'API Gateway': {
    generalUse: 'API Gateway is the managed entry point for REST and WebSocket APIs, handling request routing, throttling, authentication integration, and protocol management. It lets your backend services stay focused on business logic while API Gateway manages transport concerns and exposure to clients. In this application, WebSocket API routes provide the real-time chat channel between the browser and Lambda for prompt/response architecture workflows.',
    pros: ['Managed auth, throttling, and routing', 'Works naturally with Lambda backends', 'Supports realtime with WebSocket APIs', 'Helps standardize API operations', 'Built-in usage plans and monitoring hooks'],
    cons: ['Pricing can grow with high throughput', 'Advanced config can be complex', 'Extra hop can add latency', 'Debugging route/integration issues can take time', 'WebSocket route setup requires careful testing'],
    commonlyUsedWith: ['AWS Lambda', 'DynamoDB', 'CloudFront', 'AWS IAM', 'Amazon Bedrock'],
    docsUrl: 'https://docs.aws.amazon.com/apigateway/',
  },
  'CloudFront': {
    generalUse: 'CloudFront is a global content delivery network that caches frontend assets at edge locations near users to improve speed and responsiveness. It reduces round-trip latency, lowers load on origin services, and improves perceived app performance worldwide. For web applications, CloudFront is commonly used in front of S3-hosted frontend bundles and can also provide security controls and consistent TLS delivery behavior.',
    pros: ['Faster global content delivery', 'Reduces traffic hitting your origins', 'Strong security integrations (TLS/WAF)', 'Great for static frontend performance', 'Can reduce total backend bandwidth costs'],
    cons: ['Cache behavior can be tricky to tune', 'Invalidations may add operational overhead', 'Misconfigured cache rules can cause stale content', 'Another layer to troubleshoot', 'Pricing depends on traffic regions and volume'],
    commonlyUsedWith: ['Amazon S3', 'API Gateway', 'AWS IAM', 'CloudFormation', 'AWS Lambda'],
    docsUrl: 'https://docs.aws.amazon.com/cloudfront/',
  },
  'CloudFormation': {
    generalUse: 'CloudFormation is AWS infrastructure as code, allowing you to declare resources in templates and deploy them consistently across environments. It is useful for repeatable architecture provisioning, team collaboration through version control, and safer change management over time. In this project flow, generated CloudFormation output represents a deployment-ready path from approved architecture diagrams to infrastructure implementation.',
    pros: ['Repeatable and consistent deployments', 'Infrastructure changes are version-controlled', 'Native support for many AWS services', 'Reduces manual setup mistakes', 'Works well for team-based environments'],
    cons: ['Large templates become hard to manage', 'Troubleshooting failed stacks can be slow', 'Some updates take significant time', 'Template drift can happen outside IaC', 'Learning curve for complex stack design'],
    commonlyUsedWith: ['AWS Lambda', 'Amazon S3', 'API Gateway', 'DynamoDB', 'CloudFront'],
    docsUrl: 'https://docs.aws.amazon.com/cloudformation/',
  },
  'DynamoDB': {
    generalUse: 'DynamoDB is a low-latency NoSQL database designed for high-scale key-value and document workloads where predictable performance matters. It is commonly used for sessions, chat memory, state storage, event records, and app metadata that needs quick reads/writes. In this app, DynamoDB powers session persistence so the assistant can keep multi-turn context instead of treating each user message as an isolated request.',
    pros: ['Low-latency reads and writes', 'Fully managed with high availability', 'Scales well for heavy traffic apps', 'TTL support for auto-expiring data', 'Strong fit for session and event data'],
    cons: ['Data modeling differs from SQL thinking', 'Bad partition keys can cause hotspots', 'Complex query patterns need pre-planning', 'Costs can grow without capacity monitoring', 'Joins/relational workflows are limited'],
    commonlyUsedWith: ['AWS Lambda', 'API Gateway', 'CloudFormation', 'AWS IAM', 'Amazon Bedrock'],
    docsUrl: 'https://docs.aws.amazon.com/dynamodb/',
  },
  'AWS IAM': {
    generalUse: 'AWS IAM manages identity and authorization across AWS services through users, roles, policies, and trust relationships. It is foundational for least-privilege security, auditability, and safe service-to-service access patterns in production systems. In this project, IAM policies and execution roles ensure Lambda, API integration, DynamoDB access, and deployment workflows can run with only the permissions they actually require.',
    pros: ['Fine-grained permission control', 'Core to least-privilege security', 'Integrated across nearly all AWS services', 'Supports role-based access patterns', 'Improves auditability and compliance posture'],
    cons: ['Policies can become complex fast', 'Misconfigurations can block critical paths', 'Overly broad permissions increase risk', 'Requires ongoing governance discipline', 'Cross-account setups can be challenging'],
    commonlyUsedWith: ['AWS Lambda', 'API Gateway', 'Amazon S3', 'DynamoDB', 'Amazon Bedrock'],
    docsUrl: 'https://docs.aws.amazon.com/iam/',
  },
};

const extractLatestAssistantContent = (messages) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant' || typeof message?.content !== 'string') continue;
    return message.content;
  }
  return '';
};

const getUsedServicesFromContent = (content) => {
  const activeServices = new Set();
  if (!content) return activeServices;

  const mermaidMatch = content.match(/```mermaid\s*([\s\S]*?)```/i);
  const sourceText = (mermaidMatch?.[1] || content)
    .replace(/[`*_#>-]/g, ' ')
    .replace(/<br\/?\s*>/gi, ' ')
    .toLowerCase();

  Object.entries(SERVICE_MATCHERS).forEach(([serviceName, matcher]) => {
    if (matcher.test(sourceText)) {
      activeServices.add(serviceName);
    }
  });

  return activeServices;
};

const normalizeAssistantMessageContent = (content) => {
  if (typeof content !== 'string' || !content.includes(ASSISTANT_MERMAID_SEPARATOR)) {
    return content;
  }

  const [assistantTextRaw, mermaidRaw] = content.split(ASSISTANT_MERMAID_SEPARATOR, 2);
  const assistantText = assistantTextRaw?.trim() || '';
  const mermaidText = mermaidRaw?.trim() || '';

  if (!mermaidText) {
    return assistantText;
  }

  const hasMermaidFence = /```mermaid\s*[\s\S]*```/i.test(mermaidText);
  const mermaidBlock = hasMermaidFence ? mermaidText : `\`\`\`mermaid\n${mermaidText}\n\`\`\``;

  if (!assistantText) {
    return mermaidBlock;
  }

  return `${assistantText}\n\n${mermaidBlock}`;
};

const isValidRoleArn = (value) => IAM_ROLE_ARN_PATTERN.test((value || '').trim())

const buildDefaultStackName = (sessionId) => {
  const sanitized = String(sessionId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-8)
  return `${DEFAULT_DEPLOY_STACK_NAME_PREFIX}-${sanitized || 'default'}`
}

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [ws, setWs] = useState(null);
  const [isTestMode, setIsTestMode] = useState(DEFAULT_TEST_MODE);
  const [sessionID, setSessionID] = useState(() => getStoredSessionId());
  const [theme, setTheme] = useState(() => getStoredTheme());
  
  // Modal States
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [deployStatus, setDeployStatus] = useState('');
  const [isFetchingExternalId, setIsFetchingExternalId] = useState(false);
  const [latestExternalId, setLatestExternalId] = useState('');
  const [latestQuickCreateLink, setLatestQuickCreateLink] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const [selectedServices, setSelectedServices] = useState([]);
  const [activeServiceInfo, setActiveServiceInfo] = useState(null);
  const [expandedAnalysisByMessage, setExpandedAnalysisByMessage] = useState({});
  const [chatBodyHeight, setChatBodyHeight] = useState(null);
  const [inputAreaHeight, setInputAreaHeight] = useState(null);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [isMobileServicesOpen, setIsMobileServicesOpen] = useState(false);
  const [homeVerbIndex, setHomeVerbIndex] = useState(0);
  const [copiedSectionKey, setCopiedSectionKey] = useState(null);

  useEffect(() => {
    const finalIndex = HOME_ROTATING_VERBS.length - 1
    const intervalId = window.setInterval(() => {
      setHomeVerbIndex((prev) => {
        if (prev >= finalIndex) {
          window.clearInterval(intervalId)
          return prev
        }
        return prev + 1
      })
    }, 1800)

    return () => window.clearInterval(intervalId)
  }, [])

  const simulateStreaming = (fullText, analysis) => {
    setIsLoading(false);
    const timestamp = getCurrentTime();
    setMessages(prev => [...prev, {
      role: "assistant",
      content: "",
      analysis: null,
      timestamp,
      isStreaming: true
    }]);

    const chunkSize = 15;
    const delay = 10;
    let currentIndex = 0;

    const intervalId = setInterval(() => {
      currentIndex += chunkSize;
      const currentText = fullText.slice(0, currentIndex);
      
      setMessages(prev => {
        const newMessages = [...prev];
        const lastIndex = newMessages.length - 1;
        
        if (currentIndex >= fullText.length) {
          clearInterval(intervalId);
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: fullText,
            analysis: analysis,
            isStreaming: false
          };
        } else {
          newMessages[lastIndex] = {
            ...newMessages[lastIndex],
            content: currentText
          };
        }
        return newMessages;
      });
    }, delay);
  };

  const appContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const inputAreaRef = useRef(null);
  const appMetaFooterRef = useRef(null);
  const modeMenuRef = useRef(null);
  const responseTimeoutRef = useRef(null);

  const MIN_CHAT_BODY_HEIGHT = 220;
  const MIN_INPUT_SECTION_HEIGHT = 220;
  const RESIZE_HANDLE_HEIGHT = 0;
  const BASE_INPUT_SECTION_HEIGHT = 300;
  const MAX_INPUT_SECTION_RATIO = 0.7;

  const clearResponseTimeout = () => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
  };

  const toggleAnalysisDetails = (messageIndex) => {
    setExpandedAnalysisByMessage((prev) => ({
      ...prev,
      [messageIndex]: !prev[messageIndex],
    }))
  }

  const buildBulletedList = (items = []) =>
    items
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => `- ${item.trim()}`)
      .join('\n')

  const handleCopySection = async (text, sectionKey) => {
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setCopiedSectionKey(sectionKey)
      window.setTimeout(() => {
        setCopiedSectionKey((prev) => (prev === sectionKey ? null : prev))
      }, 1400)
    } catch (error) {
      console.warn('Unable to copy section text:', error)
    }
  }

  const startResponseTimeout = () => {
    clearResponseTimeout();
    responseTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '**Timeout Error:** The backend did not respond in time. This is usually an AWS backend issue (Lambda/Bedrock/permissions), not your browser.',
          timestamp: getCurrentTime(),
        },
      ]);
    }, 45000);
  };

  const awsServices = [
    "Amazon Bedrock", "AWS Lambda", "Amazon S3", "API Gateway", 
    "CloudFront", "DynamoDB", "AWS IAM"
  ];

  const buildQuickCreateLink = (externalId) => {
    const encodedS3Url = encodeURIComponent(SETUP_TEMPLATE_URL);
    return `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${encodedS3Url}&stackName=ChatbotConnect&param_ExternalID=${externalId}`;
  };

  const requestExternalIdFromServer = () => {
    return new Promise((resolve, reject) => {
      if (!sessionID) {
        reject(new Error('Please send at least one chat message first so a session can be created.'));
        return;
      }

      const externalIdSocket = new WebSocket(WS_URL);
      let settled = false;

      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          externalIdSocket.close();
        } catch (closeError) {
          console.warn('Failed to close external ID socket cleanly:', closeError);
        }
        resolve(value);
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          externalIdSocket.close();
        } catch (closeError) {
          console.warn('Failed to close external ID socket cleanly:', closeError);
        }
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const timeoutId = setTimeout(() => {
        finishReject(new Error('Timed out while waiting for ExternalID from backend.'));
      }, 20000);

      externalIdSocket.onopen = () => {
        externalIdSocket.send(JSON.stringify({
          action: 'getExternalId',
          sessionID,
        }));
      };

      externalIdSocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            finishReject(new Error(data.error));
            return;
          }

          if (typeof data.externalID === 'string' && data.externalID.trim()) {
            finishResolve(data.externalID.trim());
            return;
          }
        } catch (parseError) {
          finishReject(new Error('Invalid ExternalID response from backend.'));
          return;
        }

        finishReject(new Error('ExternalID response did not include a valid externalID.'));
      };

      externalIdSocket.onerror = () => {
        finishReject(new Error('Lost connection to AWS backend.'));
      };

      externalIdSocket.onclose = () => {
        if (!settled) {
          finishReject(new Error('WebSocket disconnected before ExternalID request completed.'));
        }
      };
    });
  };

  const activeServices = useMemo(() => {
    const latestAssistantContent = extractLatestAssistantContent(messages);
    return getUsedServicesFromContent(latestAssistantContent);
  }, [messages]);

  const hasValidRoleArn = useMemo(() => isValidRoleArn(roleArn), [roleArn]);

  useEffect(() => {
    if (isTestMode) {
      setWs(null);
      setIsLoading(false);
      console.log('🧪 Running in TEST MODE. WebSocket is disabled.');
      if (ws) {
        ws.close();
        setWs(null);
      }
      return; 
    }

    console.log(`🌐 Attempting WebSocket connection to ${WS_URL}`);
    const socket = new WebSocket(WS_URL);
    
    socket.onopen = () => console.log('✅ WebSocket Connected!');
    
    socket.onmessage = (event) => {
      clearResponseTimeout();
      setIsLoading(false);
      try {
        const data = JSON.parse(event.data);

        if (typeof data.sessionID === 'string' && data.sessionID.trim()) {
          const returnedSessionID = data.sessionID.trim();
          setSessionID((prev) => {
            if (prev !== returnedSessionID) {
              storeSessionId(returnedSessionID);
            }

            return returnedSessionID;
          });
        }

        if (data.mermaid_code) {
          const botResponse = `Here is your architecture:\n\n\`\`\`mermaid\n${data.mermaid_code}\n\`\`\``;
          simulateStreaming(botResponse, data.analysis || null);
        } else if (data.cloudformation_yaml) {
          const botResponse = `Here is your CloudFormation template:\n\n\`\`\`yaml\n${data.cloudformation_yaml}\n\`\`\``;
          simulateStreaming(botResponse, null);
        } else if (data.error) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**Backend Error:** ${data.error}`, timestamp: getCurrentTime() }]);
        } else if (data.message) {
          simulateStreaming(normalizeAssistantMessageContent(data.message), null);
        } else {
          console.log('Received message from backend:', data);
        }
      } catch (err) { 
        console.error("Message parse error:", err); 
      }
    };

    socket.onerror = (error) => {
      console.error(`❌ WebSocket Error while connecting to ${WS_URL}:`, error);
      clearResponseTimeout();
      setIsLoading(false);
    };

    socket.onclose = (event) => {
      console.warn(
        `⚠️ WebSocket Disconnected (code=${event.code}, reason="${event.reason || 'no reason provided'}", clean=${event.wasClean})`
      );
      clearResponseTimeout();
      setIsLoading(false); 
    };

    setWs(socket);
    return () => {
      clearResponseTimeout();
      socket.close();
    };
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

  useEffect(() => {
    storeTheme(theme)
  }, [theme])

  const handleThemeToggle = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const resizeChatBody = (clientY) => {
    const appEl = appContainerRef.current
    const metaFooterEl = appMetaFooterRef.current
    const inputAreaEl = inputAreaRef.current
    if (!appEl || typeof clientY !== 'number') {
      return
    }

    const appRect = appEl.getBoundingClientRect()
    const headerEl = appEl.querySelector('.chat-header')
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0
    const metaFooterHeight = metaFooterEl ? metaFooterEl.getBoundingClientRect().height : 0

    const availableHeight = appRect.height - headerHeight - metaFooterHeight - RESIZE_HANDLE_HEIGHT

    if (availableHeight <= 0) {
      return
    }

    // dynamically calculate minimum required height for input section
    let dynamicMinInputHeight = MIN_INPUT_SECTION_HEIGHT;
    if (inputAreaEl) {
      const isMobile = window.innerWidth <= 640;
      // On mobile, if services aren't open, we need less space.
      if (isMobile && !isMobileServicesOpen) {
        dynamicMinInputHeight = 100; // Roughly form height + controls height
      } else {
        // Full minimum height for desktop or open mobile panel
        dynamicMinInputHeight = MIN_INPUT_SECTION_HEIGHT; 
      }
    }

    const pointerFromTop = clientY - appRect.top - headerHeight
    const minChatHeight = MIN_CHAT_BODY_HEIGHT
    const maxChatHeight = Math.max(minChatHeight, availableHeight - dynamicMinInputHeight)
    let nextChatHeight = Math.min(maxChatHeight, Math.max(minChatHeight, pointerFromTop))
    let nextInputHeight = Math.max(dynamicMinInputHeight, availableHeight - nextChatHeight)

    const maxInputByViewport = Math.floor(appRect.height * MAX_INPUT_SECTION_RATIO)
    const maxInputHeight = Math.max(dynamicMinInputHeight, maxInputByViewport)

    if (nextInputHeight > maxInputHeight) {
      nextInputHeight = maxInputHeight
      nextChatHeight = Math.max(minChatHeight, availableHeight - nextInputHeight)
    }

    setChatBodyHeight(nextChatHeight)
    setInputAreaHeight(nextInputHeight)
  }

  useEffect(() => {
    setInputAreaHeight(null);
    setChatBodyHeight(null);
  }, [isMobileServicesOpen]);

  const startChatResize = (event) => {
    event.preventDefault()
    setIsResizingChat(true)
  }

  useEffect(() => {
    if (!isResizingChat) {
      return
    }

    const handleMouseMove = (event) => {
      resizeChatBody(event.clientY)
    }

    const handleTouchMove = (event) => {
      if (!event.touches?.length) return
      resizeChatBody(event.touches[0].clientY)
    }

    const stopResize = () => {
      setIsResizingChat(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', stopResize)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', stopResize)
    }
  }, [isResizingChat])

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

    if (selectedServices.length === 0) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '**Select Services First:** Please select at least one AWS service from the panel before generating an architecture.',
          timestamp: getCurrentTime(),
        },
      ]);
      return;
    }

    const userMessage = inputValue;
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: getCurrentTime() }]);
    setInputValue('');
    setIsLoading(true);

    if (isTestMode) {
      // 🧪 Fake the backend response
      setTimeout(() => {
        const mockSessionID = sessionID || generateLocalSessionId();
        if (!sessionID) {
          setSessionID(mockSessionID);
          storeSessionId(mockSessionID);
        }

        const selectedSummary = selectedServices.length > 0
          ? selectedServices.join(', ')
          : 'API Gateway, AWS Lambda, DynamoDB'

        const mockAnalysis = {
          why_this_architecture:
            `This architecture uses an API entry point, serverless compute, and managed persistence for a scalable and low-ops baseline. It aligns with your selected services: ${selectedSummary}.`,
          pros: [
            'Serverless path reduces operational overhead',
            'Components can scale independently with traffic',
            'Managed services simplify reliability and maintenance',
            'Clear separation between API, compute, and data layers',
          ],
          cons: [
            'Cold starts may add occasional latency',
            'Distributed architecture can be harder to debug',
            'Costs can increase with very high request volumes',
            'Strong IAM boundaries are required to stay secure',
          ],
          improvements:
            'Add CloudFront caching, observability dashboards/alarms, and stricter IAM least-privilege policies. For production, also add retries, DLQs, and performance testing under load.',
        }

        setIsLoading(false);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: "Here is your architecture:\n\n```mermaid\ngraph LR\nUser --> API[API Gateway]\nAPI --> Lambda[AWS Lambda]\nLambda --> DB[(DynamoDB)]\n```", 
          analysis: mockAnalysis,
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
      ws.send(JSON.stringify({
        action: "sendMessage",
        sessionID: sessionID || null,
        userInput: userMessage,
        services: selectedServices
      }));
      startResponseTimeout();
    }
  };

  // --- INITIATE DEPLOY (ASK "ARE YOU SURE?" FIRST) ---
  const handleInitiateDeploy = () => {
    const isConfirmed = window.confirm("Are you sure you want to proceed to deployment? This will eventually create live resources in your AWS account and may incur charges.");
    
    if (isConfirmed) {
      setDeployError('');
      setDeployStatus('');
      setLatestExternalId('');
      setLatestQuickCreateLink('');
      setRoleArn('');
      setIsDeployModalOpen(true);
    }
  };

  const handleConnectAwsAccount = async () => {
    setDeployError('');
    setDeployStatus('');

    if (!isTestMode && !sessionID) {
      setDeployError('Please send at least one chat message first so a session can be created.');
      return;
    }

    setIsFetchingExternalId(true);
    try {
      let externalId = '';
      if (isTestMode) {
        externalId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : generateLocalSessionId();
      } else {
        externalId = await requestExternalIdFromServer();
      }

      setLatestExternalId(externalId);
      const quickLink = buildQuickCreateLink(externalId);
      setLatestQuickCreateLink(quickLink);

      // --- NEW DYNAMIC POPUP SIZING ---
      const maxWidth = window.screen.width * 0.9;
      const maxHeight = window.screen.height * 0.9;
      const popupWidth = Math.floor(Math.min(1200, maxWidth));
      const popupHeight = Math.floor(Math.min(850, maxHeight));
      
      const left = Math.max(0, Math.floor((window.screen.width - popupWidth) / 2));
      const top = Math.max(0, Math.floor((window.screen.height - popupHeight) / 2));
      const features = `popup=yes,width=${popupWidth},height=${popupHeight},left=${left},top=${top},resizable=yes,scrollbars=yes`;
      
      const popup = window.open(quickLink, 'cloudweaver-cfn-setup', features);

      if (!popup) {
        setDeployError('Popup was blocked. Use the fallback link below to open CloudFormation setup.');
      } else {
        setDeployStatus('CloudFormation setup opened in a popup window. Complete the stack there, then submit your Role ARN below.');
      }
    } catch (error) {
      setDeployError(error.message || 'Unable to prepare your AWS setup link.');
    } finally {
      setIsFetchingExternalId(false);
    }
  };

  const handleGenerateCloudFormationWithArn = () => {
    if (isLoading) {
      return;
    }

    setDeployError('');

    const normalizedRoleArn = roleArn.trim();
    if (!hasValidRoleArn) {
      setDeployError('Enter a valid IAM Role ARN before generating CloudFormation.');
      return;
    }

    if (!isTestMode && !sessionID) {
      setDeployError('Please send at least one chat message first so a session can be created.');
      return;
    }

    if (isTestMode) {
      setMessages(prev => [...prev,
        {
          role: 'user',
          content: `Use this Role ARN for deployment: ${normalizedRoleArn}`,
          timestamp: getCurrentTime(),
        },
        {
          role: 'assistant',
          content: 'Test mode: would now request CloudFormation generation with your provided Role ARN.',
          timestamp: getCurrentTime(),
        },
      ]);
      setIsDeployModalOpen(false);
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setDeployError('Lost connection to AWS backend.');
      return;
    }

    const targetStackName = buildDefaultStackName(sessionID);

    setIsDeployModalOpen(false);
    setIsLoading(true);
    setMessages(prev => [...prev, {
      role: 'user',
      content: `Generate CloudFormation using Role ARN: ${normalizedRoleArn} (region: ${DEFAULT_DEPLOY_REGION}, stack: ${targetStackName})`,
      timestamp: getCurrentTime(),
    }]);

    ws.send(JSON.stringify({
      action: 'generateCloudFormation',
      sessionID: sessionID || null,
      userInput: 'Generate CloudFormation for the latest approved architecture.',
      services: selectedServices,
      arn: normalizedRoleArn,
      roleArn: normalizedRoleArn,
      region: DEFAULT_DEPLOY_REGION,
      stackName: targetStackName,
      setupStackName: DEFAULT_SETUP_STACK_NAME,
    }));
    startResponseTimeout();
  };

  const handleCloseModal = () => {
    setIsDeployModalOpen(false);
    setDeployError('');
    setDeployStatus('');
  };

  const handleServiceToggle = (service) => {
    setSelectedServices(prev => (
      prev.includes(service)
        ? prev.filter(item => item !== service)
        : [...prev, service]
    ));
  };

  const resetUiForModeChange = () => {
    setMessages([]);
    setInputValue('');
    setIsLoading(false);
    setIsUserScrolledUp(false);
    setDeployError('');
    setDeployStatus('');
    setIsModeMenuOpen(false);
    setIsDeployModalOpen(false);
    setActiveServiceInfo(null);
    setLatestExternalId('');
    setLatestQuickCreateLink('');
    setRoleArn('');
  };

  const handleModeSelect = (mode) => {
    const nextIsTestMode = mode === 'test';
    setIsModeMenuOpen(false);

    if (nextIsTestMode === isTestMode) return;

    resetUiForModeChange();
    setIsTestMode(nextIsTestMode);
  };

  const controlsScale = useMemo(() => {
    if (!inputAreaHeight) {
      return 1
    }

    const rawScale = inputAreaHeight / BASE_INPUT_SECTION_HEIGHT
    const clampedScale = Math.min(1.18, Math.max(0.84, rawScale))
    return Number(clampedScale.toFixed(3))
  }, [inputAreaHeight])

  const markdownComponents = useMemo(
    () => ({
      p(props) {
        const { children, ...rest } = props
        const text = Array.isArray(children)
          ? children.filter((child) => typeof child === 'string').join('').trim()
          : typeof children === 'string'
            ? children.trim()
            : ''

        if (text === 'Here is your architecture:') {
          return (
            <p {...rest} className="architecture-intro">
              {children}
            </p>
          )
        }

        return <p {...rest}>{children}</p>
      },
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

  const activeServiceDetails = activeServiceInfo ? SERVICE_INFO[activeServiceInfo] : null

  return (
    <div
      ref={appContainerRef}
      className={`chat-container ${theme === 'light' ? 'theme-light' : 'theme-dark'} ${isResizingChat ? 'chat-resizing' : ''}`}
    >
      <header className="chat-header">
        <h1>Cloud Weaver</h1>
        <button
          type="button"
          className={`theme-toggle ${theme === 'light' ? 'theme-toggle--light' : 'theme-toggle--dark'}`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          onClick={handleThemeToggle}
        >
          <span className="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">☀</span>
          <span className="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">🌙</span>
          <span className="theme-toggle__thumb" aria-hidden="true">
            <span className="theme-toggle__thumb-icon">{theme === 'light' ? '☀' : '🌙'}</span>
          </span>
        </button>
      </header>

      <div
        className="chat-body-scroll"
        ref={chatContainerRef}
        onScroll={handleScroll}
      >
        {messages.length > 0 ? (
          <main className="messages-area">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">
                <ReactMarkdown components={msg.isStreaming ? undefined : markdownComponents}>
                  {msg.content}
                </ReactMarkdown>

                {msg.analysis && (
                  <section className="reasoning-panel" aria-label="Architecture reasoning">
                    <div className="reasoning-section-header">
                      <h4>Why this architecture</h4>
                      <button
                        type="button"
                        className="section-copy-button"
                        onClick={() => handleCopySection(msg.analysis.why_this_architecture, `${index}-why`)}
                        aria-label="Copy Why this architecture"
                        title={copiedSectionKey === `${index}-why` ? 'Copied' : 'Copy'}
                      >
                        {copiedSectionKey === `${index}-why` ? (
                          <span className="section-copy-button__icon section-copy-button__icon--copied" aria-hidden="true">✓</span>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="section-copy-button__icon">
                            <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                            <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <p>{msg.analysis.why_this_architecture}</p>

                    {expandedAnalysisByMessage[index] && (
                      <>
                        <div className="reasoning-section-header reasoning-section-header--subtle">
                          <h4>Pros &amp; Cons</h4>
                          <button
                            type="button"
                            className="section-copy-button"
                            onClick={() =>
                              handleCopySection(
                                `Pros:\n${buildBulletedList(msg.analysis.pros || [])}\n\nCons:\n${buildBulletedList(msg.analysis.cons || [])}`,
                                `${index}-pros-cons`,
                              )
                            }
                            aria-label="Copy Pros and Cons"
                            title={copiedSectionKey === `${index}-pros-cons` ? 'Copied' : 'Copy'}
                          >
                            {copiedSectionKey === `${index}-pros-cons` ? (
                              <span className="section-copy-button__icon section-copy-button__icon--copied" aria-hidden="true">✓</span>
                            ) : (
                              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="section-copy-button__icon">
                                <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                                <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                              </svg>
                            )}
                          </button>
                        </div>

                        <div className="reasoning-pros-cons-grid">
                          <div className="reasoning-column reasoning-column--pros">
                            <h5>Pros</h5>
                            <ul>
                              {(msg.analysis.pros || []).map((item, idx) => (
                                <li key={`pro-${idx}-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="reasoning-column reasoning-column--cons">
                            <h5>Cons</h5>
                            <ul>
                              {(msg.analysis.cons || []).map((item, idx) => (
                                <li key={`con-${idx}-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="reasoning-section-header">
                          <h4>Improvements</h4>
                          <button
                            type="button"
                            className="section-copy-button"
                            onClick={() => handleCopySection(msg.analysis.improvements, `${index}-improvements`)}
                            aria-label="Copy Improvements"
                            title={copiedSectionKey === `${index}-improvements` ? 'Copied' : 'Copy'}
                          >
                            {copiedSectionKey === `${index}-improvements` ? (
                              <span className="section-copy-button__icon section-copy-button__icon--copied" aria-hidden="true">✓</span>
                            ) : (
                              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="section-copy-button__icon">
                                <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                                <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <p>{msg.analysis.improvements}</p>
                      </>
                    )}

                    <div className="analysis-toggle-row">
                      <button
                        type="button"
                        className="analysis-toggle-button"
                        aria-expanded={Boolean(expandedAnalysisByMessage[index])}
                        aria-label={expandedAnalysisByMessage[index] ? 'Hide architecture details' : 'Show architecture details'}
                        onClick={() => toggleAnalysisDetails(index)}
                      >
                        <span className="analysis-toggle-button__icon" aria-hidden="true">
                          {expandedAnalysisByMessage[index] ? '−' : '+'}
                        </span>
                      </button>
                    </div>
                  </section>
                )}

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
          {isLoading && (
            <div className="message assistant">
              <div className="message-content typing-indicator" aria-live="polite">
                <span className="typing-indicator__label">Generating response</span>
                <span className="typing-indicator__dots" aria-hidden="true">...</span>
              </div>
            </div>
          )}
          </main>
        ) : (
          <div className="home-screen">
            <h2>
              Let&apos;s start
              <span className="home-screen__verb-window" aria-live="polite" aria-atomic="true">
                <span key={HOME_ROTATING_VERBS[homeVerbIndex]} className="home-screen__rolling-verb">
                  {HOME_ROTATING_VERBS[homeVerbIndex]}
                </span>
              </span>
            </h2>
            <h1>Where should we start?</h1>
            <p className="home-screen-copy">
              Describe your app and constraints. Cloud Weaver will propose an AWS architecture and diagram you can refine toward deployment.
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div
        className="chat-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize chat area"
        onMouseDown={startChatResize}
        onTouchStart={startChatResize}
      >
        <span className="chat-resize-handle__circle" aria-hidden="true">
          <span className="chat-resize-handle__icon">↕</span>
        </span>
      </div>

      <InputArea
        inputAreaRef={inputAreaRef}
        inputAreaHeight={inputAreaHeight}
        controlsScale={controlsScale}
        isUserScrolledUp={isUserScrolledUp}
        messages={messages}
        scrollToBottom={scrollToBottom}
        modeMenuRef={modeMenuRef}
        isTestMode={isTestMode}
        setIsHelpModalOpen={setIsHelpModalOpen}
        setIsModeMenuOpen={setIsModeMenuOpen}
        isModeMenuOpen={isModeMenuOpen}
        handleModeSelect={handleModeSelect}
        setIsMobileServicesOpen={setIsMobileServicesOpen}
        isMobileServicesOpen={isMobileServicesOpen}
        handleSendMessage={handleSendMessage}
        inputValue={inputValue}
        setInputValue={setInputValue}
        isLoading={isLoading}
        awsServices={awsServices}
        activeServices={activeServices}
        selectedServices={selectedServices}
        handleServiceToggle={handleServiceToggle}
        setActiveServiceInfo={setActiveServiceInfo}
      />

      <div ref={appMetaFooterRef} className="app-meta-footer" aria-label="Application footer">
        <span>© 2026 Cloud Weaver</span>
        <span aria-hidden="true">•</span>
        <a href="https://github.com/elcosas/aws-architect" target="_blank" rel="noreferrer">
          About
        </a>
      </div>

      <ServiceInfoModal 
        activeServiceInfo={activeServiceInfo} 
        serviceDetails={activeServiceDetails} 
        onClose={() => setActiveServiceInfo(null)} 
      />
      
      <HelpGuideModal 
        isOpen={isHelpModalOpen} 
        onClose={() => setIsHelpModalOpen(false)} 
      />

      <DeployModal
        isOpen={isDeployModalOpen}
        onClose={handleCloseModal}
        deployError={deployError}
        setDeployError={setDeployError}
        deployStatus={deployStatus}
        latestQuickCreateLink={latestQuickCreateLink}
        latestExternalId={latestExternalId}
        roleArn={roleArn}
        setRoleArn={setRoleArn}
        hasValidRoleArn={hasValidRoleArn}
        isFetchingExternalId={isFetchingExternalId}
        isDeploying={isLoading}
        onConnectAwsAccount={handleConnectAwsAccount}
        onDeployServices={handleGenerateCloudFormationWithArn}
      />
    </div>
  )
}

export default App