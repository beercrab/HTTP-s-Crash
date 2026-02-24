document.addEventListener('DOMContentLoaded', () => {
  const requestTbody = document.querySelector('#requestTable tbody');
  const saveBtn = document.getElementById('saveBtn');

  chrome.runtime.sendMessage({ action: 'getAuditData' }, (data) => {
    if (data) {
      renderRequests(data.allRequests || []);
    }
  });

  function renderRequests(requests) {
    requestTbody.innerHTML = '';
    requests.slice(0, 500).forEach(log => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${new Date(log.timestamp).toLocaleString()}</td>
        <td>${log.type || ''}</td>
        <td>${log.method || ''}</td>
        <td class="url-cell" title="${log.url}">${log.url}</td>
        <td>${log.statusCode || ''}</td>
        <td>${log.ip || ''}</td>
        <td>${log.error || ''}</td>
      `;
      requestTbody.appendChild(row);
    });
  }

  saveBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'getAuditData' }, (data) => {
      const content = generateAuditText(data);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0,10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  function generateAuditText(data) {
    let text = `上网审计报告 - 生成时间: ${new Date().toLocaleString()}\n`;
    text += '='.repeat(60) + '\n\n';
    text += '【所有请求日志】\n';
    (data.allRequests || []).forEach((log, i) => {
      text += `${i+1}. [${new Date(log.timestamp).toLocaleString()}] ${log.method} ${log.url} 状态:${log.statusCode} IP:${log.ip} 错误:${log.error}\n`;
    });
    return text;
  }
});