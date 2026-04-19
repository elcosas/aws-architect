import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import MermaidChart from './MermaidChart'
import './styles/App.css'

const DEFAULT_TEST_MODE = import.meta.env.VITE_TEST_MODE !== 'false'
const WS_URL =
  import.meta.env.VITE_WS_URL || 'wss://9vihcpxj86.execute-api.us-west-2.amazonaws.com/dev'
const SESSION_STORAGE_KEY = 'aws-architect.sessionID'
const ASSISTANT_MERMAID_SEPARATOR = '\n\n<<<MERMAID_DIAGRAM>>>\n\n'
const SETUP_TEMPLATE_URL = 'https://cloudweaver-user-templates.s3.us-west-2.amazonaws.com/cloudformation-user-setup.yml'
const IAM_ROLE_ARN_PATTERN = /^arn:aws(-[a-z]+)?:iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/

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

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [ws, setWs] = useState(null);
  const [isTestMode, setIsTestMode] = useState(DEFAULT_TEST_MODE);
  const [sessionID, setSessionID] = useState(() => getStoredSessionId());
  
  // Modal States
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [deployStatus, setDeployStatus] = useState('');
  const [isFetchingExternalId, setIsFetchingExternalId] = useState(false);
  const [latestExternalId, setLatestExternalId] = useState('');
  const [latestQuickCreateLink, setLatestQuickCreateLink] = useState('');
  const [roleArn, setRoleArn] = useState('');
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [selectedServices, setSelectedServices] = useState([]);
  const [activeServiceInfo, setActiveServiceInfo] = useState(null);

  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const modeMenuRef = useRef(null);
  const responseTimeoutRef = useRef(null);

  const clearResponseTimeout = () => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
  };

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
    "CloudFront", "CloudFormation", "DynamoDB", "AWS IAM"
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
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: botResponse,
            analysis: data.analysis || null,
            timestamp: getCurrentTime(),
          }]);
        } else if (data.cloudformation_yaml) {
          const botResponse = `Here is your CloudFormation template:\n\n\`\`\`yaml\n${data.cloudformation_yaml}\n\`\`\``;
          setMessages(prev => [...prev, { role: 'assistant', content: botResponse, timestamp: getCurrentTime() }]);
        } else if (data.error) {
          setMessages(prev => [...prev, { role: 'assistant', content: `**Backend Error:** ${data.error}`, timestamp: getCurrentTime() }]);
        } else if (data.message) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: normalizeAssistantMessageContent(data.message),
            timestamp: getCurrentTime(),
          }]);
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

        setIsLoading(false);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: "Here is the architecture based on your request:\n\n```mermaid\ngraph LR\nUser --> API[API Gateway]\nAPI --> Lambda[AWS Lambda]\nLambda --> DB[(DynamoDB)]\n```\n\n---\n\n**Why this architecture:** This design uses API Gateway and Lambda for serverless request handling with DynamoDB for durable application data.\n\n**Selected services:** API Gateway, AWS Lambda, DynamoDB\n\n**Detected in diagram:** API Gateway, AWS Lambda, DynamoDB", 
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

      const popupWidth = 1200;
      const popupHeight = 850;
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

    setIsDeployModalOpen(false);
    setIsLoading(true);
    setMessages(prev => [...prev, {
      role: 'user',
      content: `Generate CloudFormation using Role ARN: ${normalizedRoleArn}`,
      timestamp: getCurrentTime(),
    }]);

    ws.send(JSON.stringify({
      action: 'generateCloudFormation',
      sessionID: sessionID || null,
      userInput: 'Generate CloudFormation for the latest approved architecture.',
      services: selectedServices,
      roleArn: normalizedRoleArn,
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

  const activeServiceDetails = activeServiceInfo ? SERVICE_INFO[activeServiceInfo] : null

  const serviceInfoModal =
    activeServiceInfo &&
    activeServiceDetails &&
    typeof document !== 'undefined'
      ? createPortal(
        <div className="service-info-overlay" onClick={() => setActiveServiceInfo(null)}>
          <div className="service-info-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${activeServiceInfo} details`}>
            <button
              type="button"
              className="service-info-close"
              aria-label="Close service details"
              onClick={() => setActiveServiceInfo(null)}
            >
              ✕
            </button>

            <h3>{activeServiceInfo}</h3>

            <p className="service-info-section-title">General use</p>
            <p>{activeServiceDetails.generalUse}</p>

            <div className="service-pros-cons-grid">
              <div className="service-pros-cons-column">
                <p className="service-info-section-title service-info-section-title--pros">Pros</p>
                <ul>
                  {activeServiceDetails.pros.map((item) => (
                    <li key={`${activeServiceInfo}-pro-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="service-pros-cons-column">
                <p className="service-info-section-title service-info-section-title--cons">Cons</p>
                <ul>
                  {activeServiceDetails.cons.map((item) => (
                    <li key={`${activeServiceInfo}-con-${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="service-info-section-title">Commonly used with</p>
            <p>{activeServiceDetails.commonlyUsedWith.join(', ')}</p>

            <div className="service-info-docs">
              <a
                href={activeServiceDetails.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                🔗 Official AWS documentation
              </a>
            </div>
          </div>
        </div>,
        document.body,
      )
      : null

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>Cloud Weaver</h1>
      </header>

      <div className="chat-body-scroll" ref={chatContainerRef} onScroll={handleScroll}>
        {messages.length > 0 ? (
          <main className="messages-area">
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">
                <ReactMarkdown components={markdownComponents}>
                  {msg.content}
                </ReactMarkdown>

                {msg.analysis && (
                  <section className="reasoning-panel" aria-label="Architecture reasoning">
                    <h4>Why this architecture</h4>
                    <p>{msg.analysis.why_this_architecture}</p>

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

                    <h4>Improvements</h4>
                    <p>{msg.analysis.improvements}</p>
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
          {isLoading && <div className="message assistant"><div className="message-content typing-indicator"><span className="dot"></span><span className="dot"></span><span className="dot"></span></div></div>}
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
        <div ref={messagesEndRef} />
      </div>

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
          <input type="text" className="chat-input" placeholder="Ask Cloud Weaver" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isLoading} />
          <button type="submit" className="send-button" disabled={isLoading || !inputValue.trim()}>Send</button>
        </form>
        <div className="services-panel" aria-label="AWS services in current diagram">
          <div className="services-panel__header">
            <p className="services-panel__title">AWS Services in Current Diagram</p>
            <span className="services-panel__count">{activeServices.size} used • {selectedServices.length} selected</span>
          </div>
          <div className="services-grid">
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
      </footer>

      <div className="app-meta-footer" aria-label="Application footer">
        <span>© 2026 Cloud Weaver</span>
        <span aria-hidden="true">•</span>
        <a href="https://github.com/elcosas/aws-architect" target="_blank" rel="noreferrer">
          About
        </a>
      </div>

      {serviceInfoModal}

      {isDeployModalOpen && (
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
              <button type="button" className="btn-cancel" onClick={handleCloseModal}>Cancel</button>
              <button
                type="button"
                className="btn-confirm"
                onClick={handleConnectAwsAccount}
                disabled={isFetchingExternalId}
              >
                {isFetchingExternalId ? 'Preparing Link...' : 'Open AWS Setup Link'}
              </button>
              <button
                type="button"
                className="btn-confirm"
                onClick={handleGenerateCloudFormationWithArn}
                disabled={!hasValidRoleArn}
              >
                Generate CloudFormation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App