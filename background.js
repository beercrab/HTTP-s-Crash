// ==================== 全局变量与配置 ====================
let config = {
  targetUrl: 'https://www.baidu.com',
  timeout: 10000,
  autoCheckInterval: 30
};

let lastCheckResult = {
  timestamp: null,
  status: '未检测',
  statusCode: null,
  errorType: null,
  targetUrl: null,
  siteType: '未知'
};

// 缓存
const pageIPCache = new Map();
const dnsCache = new Map();
const locationCache = new Map(); // IP归属地缓存
const CACHE_TTL = 300000; // 5分钟

// 私有 IP 段
const PRIVATE_IP_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' }
];

// 日志
let allRequestLogs = [];
const MAX_ALL_LOG_ENTRIES = 2000;

// 当前标签页诊断缓存
let cachedCurrentTabDiagnosis = null;

// 自动显示开关
let autoShowEnabled = false;
let lastAutoShowTime = 0;

// ==================== WebRequest 监听（仅记录） ====================
function recordRequest(details, eventType) {
  // 允许 tabId = -1 也记录 IP 到 dnsCache（用于手动检测）
  try {
    const url = new URL(details.url);
    if (!url.protocol.startsWith('http:') && !url.protocol.startsWith('https:')) return;
    const hostname = url.hostname;
    // 如果有 IP，存入 dnsCache（无论 tabId 是否为 -1）
    if (details.ip) {
      dnsCache.set(hostname, { ip: details.ip, timestamp: Date.now() });
      // 如果是普通标签页，也存入 pageIPCache
      if (details.tabId !== -1) {
        const key = `${details.tabId}:${hostname}`;
        pageIPCache.set(key, { ip: details.ip, timestamp: Date.now() });
      }
    }
    // 仅当 tabId 不是 -1 时才记录到审计日志（避免后台请求污染）
    if (details.tabId !== -1) {
      const logEntry = {
        timestamp: Date.now(),
        type: eventType,
        method: details.method,
        url: details.url,
        statusCode: details.statusCode || null,
        ip: details.ip || null,
        error: details.error || null,
        tabId: details.tabId
      };
      allRequestLogs.unshift(logEntry);
      if (allRequestLogs.length > MAX_ALL_LOG_ENTRIES) allRequestLogs.pop();
    }
  } catch (e) {}
}

// 自动显示弹窗（当主框架请求失败时）
function maybeAutoShowPopup(tabId, statusCode, error) {
  if (!autoShowEnabled) return;
  const now = Date.now();
  if (now - lastAutoShowTime < 5000) return;
  lastAutoShowTime = now;
  chrome.action.openPopup().catch(err => console.log('openPopup error:', err));
}

chrome.webRequest.onHeadersReceived.addListener(
  d => recordRequest(d, 'onHeadersReceived'),
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  d => {
    recordRequest(d, 'onCompleted');
    if (d.type === 'main_frame' && d.statusCode && d.statusCode !== 200) {
      maybeAutoShowPopup(d.tabId, d.statusCode);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  d => {
    recordRequest(d, 'onErrorOccurred');
    if (d.type === 'main_frame') {
      maybeAutoShowPopup(d.tabId, null, d.error);
    }
  },
  { urls: ['<all_urls>'] }
);

// ==================== 工具函数 ====================
function ipToNumber(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
}

function isPrivateIP(ip) {
  if (ip === '172.16.7.99') return false;
  const ipNum = ipToNumber(ip);
  return PRIVATE_IP_RANGES.some(range => {
    const start = ipToNumber(range.start);
    const end = ipToNumber(range.end);
    return ipNum >= start && ipNum <= end;
  });
}

async function getCurrentPageIP() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    const hostname = url.hostname;
    const key = `${tab.id}:${hostname}`;
    const cached = pageIPCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.ip;
    for (const [k, v] of pageIPCache.entries()) {
      if (k.startsWith(`${tab.id}:`) && k.includes(hostname) && Date.now() - v.timestamp < CACHE_TTL) {
        return v.ip;
      }
    }
  } catch (e) {}
  return null;
}

async function getSiteType(hostname) {
  const ip = await getCurrentPageIP() || dnsCache.get(hostname)?.ip;
  if (ip) return isPrivateIP(ip) ? '内网网站' : '外网网站';
  return '未知';
}

// ==================== IP归属地查询（使用 cip.cc，中文） ====================
async function getIpLocation(ip) {
  if (!ip) return { country: '未知', region: '未知' };
  if (isPrivateIP(ip)) {
    return { country: '内网', region: '内网IP' };
  }
  // 检查缓存
  const cached = locationCache.get(ip);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.location;
  }
  try {
    const response = await fetch(`http://cip.cc/${ip}`);
    const text = await response.text();
    // 解析文本
    const lines = text.split('\n');
    let addressLine = '';
    for (let line of lines) {
      line = line.trim();
      if (line.startsWith('地址')) {
        addressLine = line;
        break;
      }
    }
    let location;
    if (addressLine) {
      const parts = addressLine.split(':');
      if (parts.length >= 2) {
        const addr = parts[1].trim();
        // 按空白分割，过滤空字符串
        const addrParts = addr.split(/\s+/).filter(p => p.length > 0);
        if (addrParts.length > 0) {
          const country = addrParts[0];
          const region = addrParts.slice(1).join(' ');
          location = { country, region };
        } else {
          location = { country: '未知', region: '未知' };
        }
      } else {
        location = { country: '未知', region: '未知' };
      }
    } else {
      location = { country: '未知', region: '未知' };
    }
    locationCache.set(ip, { location, timestamp: Date.now() });
    return location;
  } catch (e) {
    console.error('获取IP归属地失败:', e);
    return { country: '未知', region: '未知' };
  }
}

// ==================== 当前标签页诊断（支持强制刷新）====================
async function getCurrentTabDiagnosis(forceRefresh = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return { 
    status: '无法获取当前页面', 
    targetUrl: '未知', 
    siteType: '未知', 
    ip: null, 
    location: { country: '未知', region: '未知' } 
  };
  if (!tab.url.startsWith('http')) return { 
    status: '非HTTP页面', 
    targetUrl: tab.url, 
    siteType: '未知', 
    ip: null, 
    location: { country: '未知', region: '未知' } 
  };
  
  try {
    // 如果不需要强制刷新，先尝试从缓存获取
    if (!forceRefresh) {
      const url = new URL(tab.url);
      const siteType = await getSiteType(url.hostname);
      const ip = await getCurrentPageIP();
      const location = ip ? await getIpLocation(ip) : { country: '未知', region: '未知' };
      const status = siteType.includes('内网') || siteType.includes('外网') ? '连接正常' : '未知';
      return {
        timestamp: new Date().toLocaleString(),
        status,
        statusCode: siteType.includes('未知') ? null : 200,
        errorType: siteType.includes('未知') ? '无法获取连接信息' : null,
        targetUrl: tab.url,
        siteType,
        ip,
        location
      };
    } else {
      // 强制刷新：使用 testConnection 主动发起一次请求，获取最新信息
      const testResult = await testConnection(tab.url);
      return testResult;
    }
  } catch (e) {
    return { 
      status: '诊断失败', 
      errorType: e.message, 
      targetUrl: tab.url, 
      siteType: '未知',
      ip: null,
      location: { country: '未知', region: '未知' }
    };
  }
}

// ==================== 手动检测（修复 IP 获取） ====================
async function testConnection(targetUrl) {
  const timestamp = new Date().toLocaleString();
  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch {
    return { timestamp, status: 'URL格式错误', errorType: 'Invalid URL', targetUrl, siteType: '未知', ip: null, location: { country: '未知', region: '未知' } };
  }

  const hostname = urlObj.hostname;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' }
    });
    clearTimeout(timeoutId);
    const statusCode = response.status;

    // 主动解析域名获取 IP（修复手动检测 IP 为空的问题）
    let ip = dnsCache.get(hostname)?.ip || null;
    if (!ip) {
      try {
        // 使用 chrome.dns.resolve 解析域名
        const resolveResult = await chrome.dns.resolve(hostname);
        if (resolveResult && resolveResult.resultCode === 0 && resolveResult.address) {
          ip = resolveResult.address;
          // 存入缓存
          dnsCache.set(hostname, { ip, timestamp: Date.now() });
        }
      } catch (dnsError) {
        console.warn('DNS解析失败:', dnsError);
      }
    }

    const location = ip ? await getIpLocation(ip) : { country: '未知', region: '未知' };
    const siteType = ip ? (isPrivateIP(ip) ? '内网网站' : '外网网站') : '未知';
    let status = '连接正常';
    if (statusCode >= 400) status = statusCode < 500 ? '客户端错误' : '服务器错误';
    return { timestamp, status, statusCode, targetUrl, siteType, ip, location };
  } catch (error) {
    clearTimeout(timeoutId);
    const errorType = error.name === 'AbortError' ? '请求超时' : '网络错误';
    return { timestamp, status: '连接失败', errorType, targetUrl, siteType: '未知', ip: null, location: { country: '未知', region: '未知' } };
  }
}

// ==================== 存储 ====================
async function saveConfig() {
  await chrome.storage.local.set({ config, autoShowEnabled });
}

async function loadConfig() {
  const saved = await chrome.storage.local.get(['config', 'autoShowEnabled']);
  if (saved.config) config = { ...config, ...saved.config };
  if (saved.autoShowEnabled !== undefined) autoShowEnabled = saved.autoShowEnabled;
}

// ==================== 消息处理 ====================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    getStatus: () => lastCheckResult,
    getConfig: () => config,
    saveConfig: () => { config = { ...config, ...request.config }; saveConfig(); return { success: true }; },
    runTest: () => testConnection(request.targetUrl || config.targetUrl).then(sendResponse),
    getCurrentTabDiagnosis: () => {
      const forceRefresh = request.forceRefresh || false;
      return getCurrentTabDiagnosis(forceRefresh).then(sendResponse);
    },
    getAuditData: () => ({ allRequests: allRequestLogs }),
    clearHistory: () => {
      lastCheckResult = { timestamp: null, status: '未检测', statusCode: null, errorType: null, targetUrl: null, siteType: '未知' };
      return { success: true };
    },
    getAutoShowEnabled: () => ({ enabled: autoShowEnabled }),
    setAutoShowEnabled: () => { 
      autoShowEnabled = request.enabled; 
      chrome.storage.local.set({ autoShowEnabled }); 
      return { success: true }; 
    }
  };
  
  const handler = handlers[request.action];
  if (handler) {
    const result = handler();
    if (result instanceof Promise) {
      result.then(sendResponse);
      return true;
    }
    sendResponse(result);
  }
  return false;
});

// ==================== 自动检测当前标签页 ====================
async function updateCurrentTabDiagnosis() {
  cachedCurrentTabDiagnosis = await getCurrentTabDiagnosis(false); // 非强制刷新，使用缓存
}

chrome.tabs.onActivated.addListener(activeInfo => {
  updateCurrentTabDiagnosis();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0] && tabs[0].id === tabId) {
        updateCurrentTabDiagnosis();
      }
    });
  }
});

chrome.windows.onFocusChanged.addListener(windowId => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateCurrentTabDiagnosis();
  }
});

// ==================== 初始化与定时任务 ====================
loadConfig().then(() => {
  testConnection(config.targetUrl).then(r => lastCheckResult = r);
  updateCurrentTabDiagnosis();
});

// 定期清理缓存
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pageIPCache) if (now - v.timestamp > CACHE_TTL) pageIPCache.delete(k);
  for (const [k, v] of dnsCache) if (now - v.timestamp > CACHE_TTL) dnsCache.delete(k);
  for (const [k, v] of locationCache) if (now - v.timestamp > CACHE_TTL) locationCache.delete(k);
}, 3600000);