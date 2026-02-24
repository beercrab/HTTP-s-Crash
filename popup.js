document.addEventListener('DOMContentLoaded', () => {
  // DOM 元素
  const lastCheckTime = document.getElementById('lastCheckTime');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const detailsGrid = document.getElementById('detailsGrid');
  const currentUrl = document.getElementById('currentUrl');
  const siteIp = document.getElementById('siteIp');
  const siteLocation = document.getElementById('siteLocation');
  const siteType = document.getElementById('siteType');
  const statusCode = document.getElementById('statusCode');
  const errorType = document.getElementById('errorType');
  const suggestionsList = document.getElementById('suggestionsList');
  const manualUrl = document.getElementById('manualUrl');
  const testBtn = document.getElementById('testBtn');
  const clearUrlBtn = document.getElementById('clearUrlBtn');
  const manualResult = document.getElementById('manualResult');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const copyResultBtn = document.getElementById('copyResultBtn');
  const quickBtns = document.querySelectorAll('.quick-btn');
  const actionItems = document.querySelectorAll('.action-item[data-action]');
  const autoShowContainer = document.getElementById('autoShowContainer');

  // 本地互联网信息卡片元素（新增状态灯）
  const publicIp = document.getElementById('publicIp');
  const publicLocation = document.getElementById('publicLocation');
  const publicIsp = document.getElementById('publicIsp');
  const localInfoTime = document.getElementById('localInfoTime');
  const localStatusDot = document.getElementById('localStatusDot');
  const localStatusText = document.getElementById('localStatusText');

  // 初始化
  loadAutoShowStatus();
  fetchCurrentTabDiagnosis(); // 每次打开popup都强制刷新诊断
  loadConfigUrl();
  fetchLocalInternetInfo(); // 获取本地互联网信息并更新状态灯

  // 复制 URL 功能
  if (currentUrl) {
    currentUrl.addEventListener('click', () => {
      navigator.clipboard.writeText(currentUrl.textContent);
      showToast('URL 已复制', 'success');
    });
  }

  // ==================== 自动显示开关 ====================
  function loadAutoShowStatus() {
    chrome.runtime.sendMessage({ action: 'getAutoShowEnabled' }, (res) => {
      if (res) {
        const enabled = res.enabled;
        if (enabled) {
          autoShowContainer.classList.add('active');
        } else {
          autoShowContainer.classList.remove('active');
        }
      }
    });
  }

  function toggleAutoShow() {
    const currentlyEnabled = autoShowContainer.classList.contains('active');
    const newEnabled = !currentlyEnabled;
    chrome.runtime.sendMessage({ action: 'setAutoShowEnabled', enabled: newEnabled }, (res) => {
      if (res.success) {
        if (newEnabled) {
          autoShowContainer.classList.add('active');
          showToast('自动显示已开启', 'info');
        } else {
          autoShowContainer.classList.remove('active');
          showToast('自动显示已关闭', 'info');
        }
      }
    });
  }

  autoShowContainer.addEventListener('click', toggleAutoShow);

  // ==================== 当前标签页诊断（强制刷新） ====================
  function fetchCurrentTabDiagnosis() {
    chrome.runtime.sendMessage({ action: 'getCurrentTabDiagnosis', forceRefresh: true }, (result) => {
      updateCurrentSiteUI(result);
      updateSuggestions(result);
    });
  }

  function updateCurrentSiteUI(r) {
    lastCheckTime.textContent = r.timestamp || '未检测';
    statusDot.className = 'status-dot';
    if (r.status === '连接正常') statusDot.classList.add('healthy');
    else if (r.status.includes('错误') || r.status.includes('失败')) statusDot.classList.add('error');
    else if (r.status !== '未检测') statusDot.classList.add('warning');
    statusText.textContent = r.status;

    if (r.targetUrl && r.targetUrl !== '未知') {
      detailsGrid.style.display = 'flex';
      currentUrl.textContent = r.targetUrl;
      siteIp.textContent = r.ip || '无';
      if (r.location) {
        siteLocation.textContent = `${r.location.country} ${r.location.region}`.trim() || '未知';
      } else {
        siteLocation.textContent = '未知';
      }
      siteType.textContent = r.siteType;
      statusCode.textContent = r.statusCode || '无';
      errorType.textContent = r.errorType || '无';
    } else {
      detailsGrid.style.display = 'none';
    }
  }

  function updateSuggestions(r) {
    suggestionsList.innerHTML = '';
    let items = [];
    if (r.status === '非HTTP页面') {
      items = [
        '❌ 此网站地址无效，无法检测。',
        '请确保地址以 http:// 或 https:// 开头。',
        '例如: https://www.example.com'
      ];
    } else if (r.statusCode === 200) {
      items.push('✅ 此网站访问正常，无需排查。');
    } else {
      items = [
        '1. 检查网站地址是否输入正确',
        '2. 检查wifi/网线是否已连接',
        '3. 检查路由器/猫是否正常',
        '4. 检查宽带服务是否欠费',
        '5. 若仍有问题，请联系本地运营商'
      ];
      const prefix = r.statusCode || r.errorType ? `⚠️ 当前访问异常 (${r.statusCode ? 'HTTP ' + r.statusCode : r.errorType})，请按顺序排查：` : '⚠️ 当前访问异常，请按顺序排查：';
      items.unshift(prefix);
    }
    items.forEach(text => {
      const div = document.createElement('div');
      div.className = 'suggestion-item';
      let icon = 'fa-info-circle';
      if (text.includes('✅')) icon = 'fa-check-circle';
      else if (text.includes('❌')) icon = 'fa-exclamation-triangle';
      div.innerHTML = `<i class="fas ${icon}"></i><span>${text}</span>`;
      suggestionsList.appendChild(div);
    });
  }

  // ==================== 手动检测 ====================
  testBtn.addEventListener('click', runManualTest);
  clearUrlBtn.addEventListener('click', () => {
    manualUrl.value = '';
    manualResult.style.display = 'none';
  });
  manualUrl.addEventListener('keypress', (e) => e.key === 'Enter' && runManualTest());

  quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      manualUrl.value = btn.dataset.url;
    });
  });

  function runManualTest() {
    const url = manualUrl.value.trim();
    if (!url) return showToast('请输入URL', 'error');
    try { new URL(url); } catch { return showToast('URL格式不正确', 'error'); }

    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 检测中...';
    testBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'runTest', targetUrl: url }, (res) => {
      testBtn.innerHTML = '<i class="fas fa-play"></i> 检测';
      testBtn.disabled = false;
      manualResult.style.display = 'block';
      const isSuccess = res.statusCode === 200;
      manualResult.innerHTML = `
        <div style="color:${isSuccess ? '#10b981' : '#ef4444'};">
          <i class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
          <strong>${isSuccess ? '访问成功' : '访问失败'}</strong><br>
          <span>HTTP状态码: ${res.statusCode || '无'}</span>
          ${res.errorType ? `<br><span>错误: ${res.errorType}</span>` : ''}
          ${res.ip ? `<br><span>IP: ${res.ip}</span>` : ''}
          ${res.location ? `<br><span>归属地: ${res.location.country} ${res.location.region}</span>` : ''}
        </div>
      `;
    });
  }

  // ==================== 清除记录 ====================
  clearHistoryBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'clearHistory' }, () => {
      lastCheckTime.textContent = '未检测';
      statusDot.className = 'status-dot';
      statusText.textContent = '等待检测';
      detailsGrid.style.display = 'none';
      suggestionsList.innerHTML = '<div class="suggestion-item">点击刷新或重新打开弹窗检测</div>';
      manualResult.style.display = 'none';
      showToast('记录已清除', 'success');
    });
  });

  // ==================== 复制结果 ====================
  copyResultBtn.addEventListener('click', () => {
    const ipText = siteIp.textContent !== '-' ? `IP: ${siteIp.textContent}` : '';
    const locationText = siteLocation.textContent !== '-' ? `归属地: ${siteLocation.textContent}` : '';
    const text = `http's crash报告
==================
当前网站: ${currentUrl.textContent}
${ipText}
${locationText}
网站类型: ${siteType.textContent}
状态: ${statusText.textContent}
HTTP状态码: ${statusCode.textContent}
错误类型: ${errorType.textContent}
检测时间: ${lastCheckTime.textContent}
手动检测: ${manualResult.style.display === 'block' ? manualUrl.value + ' - ' + manualResult.innerText.trim() : '未执行'}`;
    navigator.clipboard.writeText(text).then(() => showToast('已复制', 'success'));
  });

  // ==================== 快速操作 ====================
  actionItems.forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (action === 'refresh') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => tabs[0] && chrome.tabs.reload(tabs[0].id));
      } else if (action === 'clearCache') {
        chrome.tabs.create({ url: 'chrome://settings/clearBrowserData' });
      } else if (action === 'audit') {
        chrome.tabs.create({ url: chrome.runtime.getURL('audit.html') });
      }
    });
  });

  // ==================== 加载配置 ====================
  function loadConfigUrl() {
    chrome.runtime.sendMessage({ action: 'getConfig' }, (cfg) => {
      if (cfg?.targetUrl) manualUrl.value = cfg.targetUrl;
    });
  }

  // ==================== 使用 cip.cc 获取本地互联网信息（含状态灯更新） ====================
  function fetchLocalInternetInfo() {
    localInfoTime.textContent = '查询中...';
    // 状态灯初始为灰色（检测中）
    localStatusDot.className = 'status-dot';
    localStatusText.textContent = '检测中';

    publicIp.textContent = '-';
    publicLocation.textContent = '-';
    publicIsp.textContent = '-';

    // 使用 cip.cc API（返回纯文本）
    fetch('http://cip.cc/')
      .then(response => response.text())
      .then(text => {
        // 解析 cip.cc 返回的文本
        const lines = text.split('\n');
        let ip = '-', location = '-', isp = '-';

        for (let line of lines) {
          line = line.trim();
          if (line.startsWith('IP')) {
            const parts = line.split(':');
            if (parts.length >= 2) ip = parts[1].trim();
          } else if (line.startsWith('地址')) {
            const parts = line.split(':');
            if (parts.length >= 2) location = parts[1].trim();
          } else if (line.startsWith('运营商')) {
            const parts = line.split(':');
            if (parts.length >= 2) isp = parts[1].trim();
          }
        }

        // 如果成功提取到IP（至少IP字段不为空且不是'-'），则认为成功
        if (ip && ip !== '-') {
          publicIp.textContent = ip;
          publicLocation.textContent = location || '-';
          publicIsp.textContent = isp || '-';
          localInfoTime.textContent = new Date().toLocaleTimeString();
          // 连接正常
          localStatusDot.classList.add('healthy');
          localStatusText.textContent = '连接正常';
        } else {
          // 解析失败，回退到备用API
          fallbackToIpApi();
        }
      })
      .catch(err => {
        console.warn('cip.cc 请求失败，尝试备用API:', err);
        fallbackToIpApi();
      });
  }

  // 备用API：ip-api.com（中文版）
  function fallbackToIpApi() {
    fetch('http://ip-api.com/json/?lang=zh-CN&fields=status,message,country,regionName,city,isp,query')
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success') {
          publicIp.textContent = data.query || '-';
          const locationParts = [];
          if (data.country) locationParts.push(data.country);
          if (data.regionName) locationParts.push(data.regionName);
          if (data.city) locationParts.push(data.city);
          publicLocation.textContent = locationParts.join(' ') || '-';
          publicIsp.textContent = data.isp || '-';
          localInfoTime.textContent = new Date().toLocaleTimeString();
          // 连接正常
          localStatusDot.classList.add('healthy');
          localStatusText.textContent = '连接正常';
        } else {
          publicIp.textContent = '获取失败';
          publicLocation.textContent = '-';
          publicIsp.textContent = '-';
          localInfoTime.textContent = '失败';
          // 连接失败
          localStatusDot.classList.add('error');
          localStatusText.textContent = '连接失败';
          console.warn('ip-api返回错误:', data.message);
        }
      })
      .catch(err => {
        console.error('所有API均获取失败:', err);
        publicIp.textContent = '获取失败';
        publicLocation.textContent = '-';
        publicIsp.textContent = '-';
        localInfoTime.textContent = '错误';
        // 连接失败
        localStatusDot.classList.add('error');
        localStatusText.textContent = '连接失败';
      });
  }

  // ==================== 提示 ====================
  function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }
});