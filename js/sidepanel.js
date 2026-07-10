// sidepanel.js —— 侧边栏主逻辑：标签切换、设置读写、采集触发、日志接收

/* ============ 标签切换 ============ */
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.panel');
let logBadgeCount = 0;

tabs.forEach((tab) => {
	tab.addEventListener('click', () => {
		const name = tab.dataset.tab;
		tabs.forEach((t) => t.classList.toggle('active', t === tab));
		panels.forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
		if (name === 'logs') resetLogBadge();
	});
});

/* ============ 自定义确认弹窗 ============ */
/**
 * 显示自定义弹窗，返回 Promise<boolean>（确定=true，取消=false）
 * @param {{title?:string,message:string,icon?:string,okText?:string,cancelText?:string,confirm?:boolean}} opts
 */
function showModal(opts) {
	const mask = document.getElementById('modalMask');
	document.getElementById('modalTitle').textContent = opts.title || '提示';
	document.getElementById('modalMsg').textContent = opts.message || '';
	document.getElementById('modalIcon').textContent = opts.icon || '!';
	const okBtn = document.getElementById('modalOk');
	const cancelBtn = document.getElementById('modalCancel');
	okBtn.textContent = opts.okText || '确定';
	cancelBtn.textContent = opts.cancelText || '取消';
	cancelBtn.style.display = opts.confirm === false ? 'none' : '';

	mask.hidden = false;

	return new Promise((resolve) => {
		function cleanup(result) {
			mask.hidden = true;
			okBtn.removeEventListener('click', onOk);
			cancelBtn.removeEventListener('click', onCancel);
			mask.removeEventListener('click', onMask);
			resolve(result);
		}
		function onOk() { cleanup(true); }
		function onCancel() { cleanup(false); }
		function onMask(e) { if (e.target === mask) cleanup(false); }
		okBtn.addEventListener('click', onOk);
		cancelBtn.addEventListener('click', onCancel);
		mask.addEventListener('click', onMask);
	});
}

/* ============ 页面类型检测 ============ */
function pageTypeInfo(url) {
	if (!url) return { ok: false, text: '未获取到页面' };
	if (url.includes('https://www.xiaohongshu.com/search_result')) {
		return url.includes('search_type=user')
			? { ok: true, text: '搜索 · 用户页' }
			: { ok: true, text: '搜索 · 笔记页' };
	}
	if (url.includes('https://www.xiaohongshu.com/user/profile')) {
		return { ok: true, text: '博主主页' };
	}
	if (url.includes('https://www.xiaohongshu.com/explore')) {
		return { ok: true, text: '推荐 / 笔记页' };
	}
	if (url.includes('xiaohongshu.com')) {
		return { ok: false, text: '小红书 · 非采集页面' };
	}
	return { ok: false, text: '请打开小红书网站' };
}

async function getActiveTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab;
}

/**
 * 向页面脚本查询当前真实的已采集数量并同步显示。
 * SPA 站内跳转数据仍在 -> 返回真实值；硬刷新数据已清空 -> 返回 0 或查询失败按 0 处理。
 */
async function syncStatFromPage(tabId) {
	try {
		const resp = await chrome.tabs.sendMessage(tabId, { type: 'get_stat' });
		setStat(resp && typeof resp.count === 'number' ? resp.count : 0);
	} catch (e) {
		setStat(0);
	}
}

async function refreshPageStatus() {
	const dot = document.getElementById('pageDot');
	const text = document.getElementById('pageTypeText');
	const tab = await getActiveTab();
	const info = pageTypeInfo(tab && tab.url);
	text.textContent = info.text;
	dot.className = 'dot ' + (info.ok ? 'ok' : 'off');
	document.getElementById('btnStart').disabled = !info.ok;
	// 计数以页面脚本为准，避免"地址变了但数据仍在"被误清零，或"刷新后数据没了仍显示旧值"
	if (tab && info.ok) {
		await syncStatFromPage(tab.id);
	} else {
		setStat(0);
	}
	return { tab, info };
}

document.getElementById('refreshPage').addEventListener('click', refreshPageStatus);

/* 清空已采集数据（内存 + 本地存储） */
document.getElementById('clearData').addEventListener('click', async () => {
	const ok = await showModal({
		title: '清空采集数据',
		message: '确定清空所有已采集数据？此操作不可恢复。',
		icon: '🗑',
		okText: '清空',
		cancelText: '取消',
	});
	if (!ok) return;
	await chrome.storage.local.set({ nmx_xhs_collected: { notes: [], users: [] } });
	const tab = await getActiveTab();
	if (tab) {
		try { await chrome.tabs.sendMessage(tab.id, { type: 'clear_data' }); } catch (e) {}
	}
	setStat(0);
	addLog('已清空采集数据', 'success');
	const el = document.getElementById('latestLog');
	if (el) el.textContent = '已清空采集数据';
});

/* 自动检测：切换标签页、页面地址变化、窗口聚焦时自动刷新页面状态 */
chrome.tabs.onActivated.addListener(() => refreshPageStatus());

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	// 地址变化或加载完成时刷新页面状态；计数在 refreshPageStatus 内以页面脚本为准同步
	if ((changeInfo.url || changeInfo.status === 'complete') && tab.active) {
		refreshPageStatus();
	}
});

if (chrome.windows && chrome.windows.onFocusChanged) {
	chrome.windows.onFocusChanged.addListener((winId) => {
		if (winId !== chrome.windows.WINDOW_ID_NONE) refreshPageStatus();
	});
}

/* ============ 采集操作 ============ */

/**
 * 确保当前标签已注入 content-script；若因扩展重载等原因未注入则按需注入。
 * @returns {Promise<boolean>} 是否成功就绪
 */
async function ensureContentScript(tabId) {
	try {
		await chrome.tabs.sendMessage(tabId, { type: 'ping' });
		return true; // 已存在
	} catch (e) {
		try {
			await chrome.scripting.executeScript({ target: { tabId }, files: ['js/content-script.js'] });
			await chrome.scripting.insertCSS({ target: { tabId }, files: ['css/page_layer.css'] });
			await new Promise((r) => setTimeout(r, 150)); // 留出注册监听器的时间
			return true;
		} catch (e2) {
			console.log('注入 content-script 失败：', e2);
			return false;
		}
	}
}

document.getElementById('btnStart').addEventListener('click', async () => {
	const { tab, info } = await refreshPageStatus();
	if (!info.ok || !tab) {
		addLog('当前不是可采集页面，请打开小红书搜索页/推荐页/博主主页', 'warn');
		return;
	}
	const ready = await ensureContentScript(tab.id);
	if (!ready) {
		addLog('无法连接页面脚本，请刷新小红书页面后重试', 'error');
		return;
	}
	addLog('已发送采集指令，开始采集…', 'info');
	// 不清零：与单篇采集累计计数，refreshPageStatus 已同步当前真实数量
	chrome.tabs.sendMessage(tab.id, { type: 'goto_start' }, () => void chrome.runtime.lastError);
});

document.getElementById('btnSingle').addEventListener('click', async () => {
	const tab = await getActiveTab();
	if (tab) await ensureContentScript(tab.id);
	addLog('已发送单篇采集指令…', 'info');
	chrome.runtime.sendMessage({ type: 'download_single_note' }, () => void chrome.runtime.lastError);
});

document.getElementById('btnExport').addEventListener('click', async () => {
	const tab = await getActiveTab();
	if (tab) await ensureContentScript(tab.id);
	addLog('正在校验密钥并导出 CSV…', 'info');
	chrome.runtime.sendMessage({ type: 'check_mkey' }, () => void chrome.runtime.lastError);
});

/* ============ 统计 ============ */
function setStat(n) {
	document.getElementById('statCount').textContent = n;
}

/* ============ 日志 ============ */
const logList = document.getElementById('logList');
const latestLog = document.getElementById('latestLog');

function pad(n) { return String(n).padStart(2, '0'); }

function nowTime() {
	const d = new Date();
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addLog(text, level = 'info') {
	// 移除空状态
	const empty = logList.querySelector('.log-empty');
	if (empty) empty.remove();

	const li = document.createElement('li');
	li.className = 'log-item ' + level;
	li.innerHTML = `<span class="log-time">${nowTime()}</span><span class="log-text"></span>`;
	li.querySelector('.log-text').textContent = text;
	logList.appendChild(li);

	// 限制条数，避免无限增长
	while (logList.children.length > 500) logList.removeChild(logList.firstChild);

	if (document.getElementById('autoScroll').checked) {
		document.querySelector('.content').scrollTop = document.querySelector('.content').scrollHeight;
		li.scrollIntoView({ block: 'nearest' });
	}

	latestLog.textContent = text;

	// 日志标签未激活时累加未读角标
	const logsActive = document.querySelector('.tab[data-tab="logs"]').classList.contains('active');
	if (!logsActive) bumpLogBadge();
}

function bumpLogBadge() {
	logBadgeCount++;
	const badge = document.getElementById('logBadge');
	badge.textContent = logBadgeCount > 99 ? '99+' : logBadgeCount;
	badge.hidden = false;
}

function resetLogBadge() {
	logBadgeCount = 0;
	document.getElementById('logBadge').hidden = true;
}

document.getElementById('clearLogs').addEventListener('click', () => {
	logList.innerHTML = '<li class="log-empty">暂无日志</li>';
	latestLog.textContent = '等待操作…';
	resetLogBadge();
});

/* ============ 接收 content-script 消息 ============ */
chrome.runtime.onMessage.addListener((message) => {
	if (!message || !message.type) return;
	if (message.type === 'collect_log') {
		addLog(message.text, message.level || 'info');
	} else if (message.type === 'collect_stat') {
		setStat(message.count);
	}
});

/* ============ 设置读写 ============ */
const settingIds = {
	mkey: 'mKey',
	download_nums: 'downLoadNums',
	time_interval: 'timeInterval',
	app_id: 'appId',
	app_secret: 'appSecret',
	app_token: 'appToken',
	table_id: 'tableId',
};
const defaults = { download_nums: 30, time_interval: 1 };

chrome.storage.local.get('nmx_xhs_setting', (result) => {
	const s = result.nmx_xhs_setting || {};
	for (const [key, id] of Object.entries(settingIds)) {
		const el = document.getElementById(id);
		if (el) el.value = s[key] ?? defaults[key] ?? '';
	}
});

document.getElementById('saveButton').addEventListener('click', () => {
	const setting = {};
	for (const [key, id] of Object.entries(settingIds)) {
		setting[key] = document.getElementById(id).value;
	}
	chrome.storage.local.set({ nmx_xhs_setting: setting }, () => {
		const tip = document.getElementById('saveTip');
		tip.textContent = '✓ 设置已保存';
		tip.classList.add('show');
		setTimeout(() => tip.classList.remove('show'), 2000);
		addLog('设置已保存', 'success');
	});
});

/* ============ 初始化 ============ */
logList.innerHTML = '<li class="log-empty">暂无日志</li>';
refreshPageStatus();
