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
	const btn = document.getElementById('btnExport');
	if (btn.disabled) return;
	btn.disabled = true;
	try {
		await exportExcel();
	} catch (e) {
		console.log('导出 Excel 失败：', e);
		addLog('导出 Excel 失败：' + e.message, 'error');
	} finally {
		btn.disabled = false;
	}
});

/* ============ 导出 Excel ============ */
const NOTE_COLUMNS = [
	{ header: '封面', key: 'cover', width: 16 },
	{ header: '笔记类型', key: 'note_type', width: 8 },
	{ header: '博主名', key: 'author', width: 14 },
	{ header: '博主地址', key: 'author_url', width: 24 },
	{ header: '笔记标题', key: 'title', width: 24 },
	{ header: '笔记内容', key: 'desc', width: 40 },
	{ header: '标签', key: 'tags', width: 20 },
	{ header: '笔记地址', key: 'url', width: 24 },
	{ header: '点赞', key: 'like_text', width: 8 },
	{ header: '点赞数', key: 'like_nums', width: 9, number: true },
	{ header: '收藏', key: 'collect_text', width: 8 },
	{ header: '收藏数', key: 'collect_nums', width: 9, number: true },
	{ header: '评论', key: 'chat_text', width: 8 },
	{ header: '评论数', key: 'chat_nums', width: 9, number: true },
	{ header: '评论内容', key: 'comments', width: 60 },
	{ header: '日期', key: 'date', width: 14 },
	{ header: '发布时间', key: 'datetime', width: 19 },
];
const USER_COLUMNS = [
	{ header: '博主名', key: 'author', width: 16 },
	{ header: '博主地址', key: 'author_url', width: 30 },
	{ header: '小红书号', key: 'xhs_no', width: 16 },
	{ header: '粉丝', key: 'fans_text', width: 10 },
	{ header: '粉丝数', key: 'fans_nums', width: 10, number: true },
	{ header: '笔记数', key: 'note_nums', width: 10, number: true },
];
const COVER_WIDTH = 100; // 封面缩略图宽度(px)
const EXCEL_CELL_MAX = 32767; // Excel 单元格字符上限

/**
 * 下载封面并转为 jpeg 缩略图（Excel 不支持 webp）
 * @returns {Promise<{base64:string,width:number,height:number}|null>} 失败返回 null
 */
async function fetchCoverThumb(url) {
	if (!url) return null;
	try {
		const resp = await fetch(url);
		if (!resp.ok) return null;
		const bitmap = await createImageBitmap(await resp.blob());
		const width = COVER_WIDTH;
		const height = Math.round(bitmap.height * width / bitmap.width);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
		bitmap.close();
		return { base64: canvas.toDataURL('image/jpeg', 0.85), width, height };
	} catch (e) {
		console.log('封面下载失败：', url, e);
		return null;
	}
}

/** 限制并发地对数组逐项执行异步任务 */
async function mapLimit(arr, limit, fn) {
	const results = new Array(arr.length);
	let next = 0;
	async function worker() {
		while (next < arr.length) {
			const i = next++;
			results[i] = await fn(arr[i], i);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
	return results;
}

function cellValue(row, col) {
	let v = row[col.key];
	if (v === undefined || v === null) return '';
	if (col.number) {
		const n = Number(v);
		return Number.isFinite(n) ? n : String(v);
	}
	v = String(v);
	return v.length > EXCEL_CELL_MAX ? v.slice(0, EXCEL_CELL_MAX - 1) + '…' : v;
}

function timestamp() {
	const d = new Date();
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function exportExcel() {
	addLog('正在校验密钥…', 'info');
	const check = await chrome.runtime.sendMessage({ type: 'check_mkey' });
	if (!check || (check.hasOwnProperty('code') && check.code != 0)) {
		addLog((check && check.message) || '密钥校验未通过', 'error');
		return;
	}

	const tab = await getActiveTab();
	const isUserPage = !!(tab && tab.url && tab.url.includes('https://www.xiaohongshu.com/search_result') && tab.url.includes('search_type=user'));
	const stored = (await chrome.storage.local.get('nmx_xhs_collected')).nmx_xhs_collected || {};
	const list = (isUserPage ? stored.users : stored.notes) || [];
	if (list.length === 0) {
		addLog('暂无可导出的数据，请先点击「开始采集」', 'warn');
		return;
	}

	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet(isUserPage ? '博主' : '笔记');
	const columns = isUserPage ? USER_COLUMNS : NOTE_COLUMNS;
	sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
	sheet.getRow(1).font = { bold: true };
	sheet.views = [{ state: 'frozen', ySplit: 1 }];

	list.forEach((row) => {
		const values = {};
		columns.forEach((c) => { values[c.key] = c.key === 'cover' ? '' : cellValue(row, c); });
		const r = sheet.addRow(values);
		r.alignment = { vertical: 'top', wrapText: true };
	});

	if (!isUserPage) {
		addLog(`正在下载 ${list.length} 张封面…`, 'info');
		let done = 0;
		const thumbs = await mapLimit(list, 5, async (row) => {
			const thumb = await fetchCoverThumb(row.cover);
			done++;
			if (done % 10 === 0 || done === list.length) latestLog.textContent = `封面下载进度 ${done}/${list.length}`;
			return thumb;
		});
		const coverCol = columns.findIndex((c) => c.key === 'cover');
		let failed = 0;
		thumbs.forEach((thumb, i) => {
			const rowIndex = i + 2; // 第 1 行为表头
			if (!thumb) {
				failed++;
				// 下载失败时保留封面链接，便于手动查看
				sheet.getRow(rowIndex).getCell(coverCol + 1).value = list[i].cover || '';
				return;
			}
			const imageId = workbook.addImage({ base64: thumb.base64, extension: 'jpeg' });
			sheet.addImage(imageId, {
				tl: { col: coverCol + 0.1, row: rowIndex - 1 + 0.1 },
				ext: { width: thumb.width, height: thumb.height },
				editAs: 'oneCell',
			});
			// 行高单位为磅(pt)，1px ≈ 0.75pt，留出上下边距
			sheet.getRow(rowIndex).height = Math.max(sheet.getRow(rowIndex).height || 15, (thumb.height + 10) * 0.75);
		});
		if (failed > 0) addLog(`${failed} 张封面下载失败，已改为写入封面链接`, 'warn');
	}

	const buffer = await workbook.xlsx.writeBuffer();
	const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
	const link = document.createElement('a');
	link.href = URL.createObjectURL(blob);
	link.download = `小红书${isUserPage ? '博主' : '笔记'}_${timestamp()}.xlsx`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 10000);
	addLog(`已导出 ${list.length} 条数据到 Excel`, 'success');
}

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
	comment_nums: 'commentNums',
	app_id: 'appId',
	app_secret: 'appSecret',
	app_token: 'appToken',
	table_id: 'tableId',
};
const defaults = { download_nums: 30, time_interval: 1, comment_nums: 20 };

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
