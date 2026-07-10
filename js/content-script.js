let currentDomain = window.location.hostname;
let downloadData = [];
let downloadUserData = [];
let downloadNums = 0;
let tenantAccessToken = "";
let feishuAppId = "";
let feishuAppSecret = "";
let feishuAppToken = "";
let feishuTableId = "";
let batchFeishuData = [];
let timeInterval = 0;
let tableHeader = [];
let tableKeys = [];

/**
 * 向侧边栏发送一条日志
 * @param text 日志内容
 * @param level info | success | warn | error
 */
function logMsg(text, level = 'info') {
	console.log('[XHS]', text);
	try {
		chrome.runtime.sendMessage({ type: 'collect_log', text: text, level: level });
	} catch (e) {
		// 侧边栏未打开时忽略
	}
}

/**
 * 向侧边栏同步已采集条数
 * @param count
 */
function sendStat(count) {
	try {
		chrome.runtime.sendMessage({ type: 'collect_stat', count: count });
	} catch (e) {}
}

const COLLECTED_KEY = 'nmx_xhs_collected';

/**
 * 持久化已采集数据到本地存储，刷新/重开页面不丢失
 */
function saveCollected() {
	try {
		chrome.storage.local.set({ [COLLECTED_KEY]: { notes: downloadData, users: downloadUserData } });
	} catch (e) {}
}

/**
 * 从本地存储恢复已采集数据
 */
function loadCollected(callback) {
	chrome.storage.local.get(COLLECTED_KEY, function (data) {
		if (data && data[COLLECTED_KEY]) {
			downloadData = data[COLLECTED_KEY].notes || [];
			downloadUserData = data[COLLECTED_KEY].users || [];
		}
		if (callback) callback();
	});
}

/**
 * 清空已采集数据（内存 + 存储）
 */
function clearCollected() {
	downloadData = [];
	downloadUserData = [];
	batchFeishuData = [];
	saveCollected();
	sendStat(0);
}

/**
 * 保存内容为csv文件
 * @param csvContent
 */
function downloadCsv(csvContent)
{
	// 创建一个 Blob 对象，将内容保存为 CSV 文件
	var blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });

	// 生成一个临时下载链接并下载文件
	var link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = "data(" + currentDomain+ ").csv";
	link.click();
}

function initTableInfo() {
	let pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile" || pageType == "explore_result_note")
	{
		tableHeader = ["博主名","博主地址","笔记标题","笔记内容","标签","笔记地址","点赞","点赞数","收藏","收藏数","评论","评论数","日期","发布时间"];
		tableKeys = ["author","author_url","title","desc","tags","url","like_text","like_nums","collect_text","collect_nums","chat_text","chat_nums","date","datetime"];
	}
	else if(pageType == "search_result_user")
	{
		tableHeader = ["博主名","博主地址","小红书号","粉丝","粉丝数","笔记数"];
		tableKeys = ["author","author_url","xhs_no","fans_text","fans_nums","note_nums"];
	}
}

async function proxyAjaxRequest(url, method = 'GET', headers = {}, body = null, callBack = null) {
	const response = await new Promise((resolve) => {
		chrome.runtime.sendMessage({
			action: 'proxyRequest',
			url: url,
			method: method,
			headers: headers,
			body: body
		}, (response) => {
			resolve(response);
		});
	});

	if(callBack != null) await callBack(response);
}

async function getFeishuToken() {
	if(!feishuAppId) return;
	await proxyAjaxRequest("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", 'POST', {"Content-Type":"application/json; charset=utf-8"}, JSON.stringify({"app_id":feishuAppId,"app_secret":feishuAppSecret}), function(response) {
		if (response.status === 'success') {
			let jsonData = JSON.parse(response.data);
			if(jsonData.code == 0) {
				tenantAccessToken = jsonData.tenant_access_token;
				logMsg('获取飞书 token 成功', 'success');
			} else {
				logMsg('获取飞书 token 失败：' + (jsonData.msg || jsonData.code), 'error');
			}
		} else {
			logMsg('获取飞书 token 请求异常：' + response.message, 'error');
		}
	});
}

async function sendFeishuData() {
	if(!tenantAccessToken || !feishuTableId) return;
	let records = [];
	for(let i = 0; i < 100; i++)
	{
		if(batchFeishuData.length <= 0) break;
		let item = batchFeishuData.shift();
		//根据 tableHeader tableKeys 生成对应的数据
		let aItem = {fields:{}};
		let fields = {};
		for(let j = 0; j < tableHeader.length; j++) {
			fields[tableHeader[j]] = `${item[tableKeys[j]]}`;
		}
		aItem.fields = fields;

		records.push(aItem);
	}
	
	if(records.length <= 0) return;
	await proxyAjaxRequest("https://open.feishu.cn/open-apis/bitable/v1/apps/" + feishuAppToken + "/tables/" + feishuTableId + "/records/batch_create", 'POST', {"Authorization":"Bearer " + tenantAccessToken,"Content-Type":"application/json; charset=utf-8"}, JSON.stringify({"records":records}),async function(response) {
		if (response.status === 'success') {
			//response.data 转json
			let jsonData = JSON.parse(response.data);
			if(jsonData.code == 0) {
				logMsg(`已同步 ${records.length} 条数据到飞书`, 'success');
			} else {
				logMsg('同步飞书数据失败：' + (jsonData.msg || jsonData.code), 'error');
			}
		} else {
			logMsg('同步飞书数据请求异常：' + response.message, 'error');
		}
	});
}

async function createFeishuTable() {
	if(!tenantAccessToken || feishuTableId) return;
	//根据 tableHeader tableKeys 生成对应的数据
	let fields = [];
	for(let i = 0; i < tableHeader.length; i++) {
		let field = {"field_name":tableHeader[i],"type":1};
		fields.push(field);
	}
	//随机起名字 小红书 + 年月日时分秒
	let tableName = "小红书" + new Date().toLocaleString();

	await proxyAjaxRequest("https://open.feishu.cn/open-apis/bitable/v1/apps/" + feishuAppToken + "/tables", 'POST', {"Authorization":"Bearer " + tenantAccessToken,"Content-Type":"application/json; charset=utf-8"}, JSON.stringify({"table":{"name":tableName,"fields":fields}}),async function(response) {
		if (response.status === 'success') {
			//response.data 转json
			let jsonData = JSON.parse(response.data);
			if(jsonData.code == 0) {
				feishuTableId = jsonData.data.table_id;
				logMsg('已自动创建飞书表格：' + tableName, 'success');
			} else {
				logMsg('创建飞书表格失败：' + (jsonData.msg || jsonData.code), 'error');
			}
		} else {
			logMsg('创建飞书表格请求异常：' + response.message, 'error');
		}
	});
}


async function addFeishuData(data) {
	if(!tenantAccessToken || !feishuTableId) return;
	let xhsKey = extractXhsKey(data.url);
	let url = "https://open.feishu.cn/open-apis/bitable/v1/apps/" + feishuAppToken + "/tables/" + feishuTableId + "/records/search?page_size=500";
	await proxyAjaxRequest(url, 'POST', {"Authorization":"Bearer " + tenantAccessToken,"Content-Type":"application/json; charset=utf-8"}, JSON.stringify({"filter":{"conjunction":"and","conditions":[{"field_name": "笔记地址","operator": "contains","value": [xhsKey]}]}}),async function(response) {
		if(!response) return;
		if (response.status === 'success') {
			let jsonData = JSON.parse(response.data);
			if(jsonData.code == 0) {
				if(jsonData.data.total > 0) {
					logMsg('该笔记已存在于飞书表格，跳过', 'warn');
				} else {
					logMsg('已加入飞书同步队列', 'success');
					addUniqueData(batchFeishuData,data,'url');
				}
			} else {
				logMsg('查询飞书数据失败：' + (jsonData.msg || jsonData.code), 'error');
			}
		} else {
			logMsg('查询飞书数据请求异常：' + response.message, 'error');
		}
	});
}

function extractXhsKey(url) {
    // 使用正则表达式匹配 /explore/ 后的字母和数字组合
    const regex = /\/explore\/([a-z0-9]+)/;
    const match = url.match(regex);
    
    // 如果匹配成功，返回提取的字符串，否则返回 null
    return match ? match[1] : null;
}

async function goStart() {
	let pageType = getPageType();
	const typeName = {
		"search_result_note": "搜索笔记页",
		"search_result_user": "搜索用户页",
		"user_profile": "博主主页",
		"explore_result_note": "推荐/笔记页"
	}[pageType] || "未知页面";
	logMsg(`开始采集，页面类型：${typeName}`, 'info');
	// 不重置数据：单篇采集与自动采集累计计数（getSearchVideoData 内按 url 去重，不会重复）
	initTableInfo();
	await getFeishuToken();
	await createFeishuTable();
	initOtherActon();
}

async function goStartDownloadSingleNote() {
	logMsg('开始采集当前单篇笔记…', 'info');
	initTableInfo();
	await getFeishuToken();
	await createFeishuTable();
	await getCurrentNodeData();
	startFeishuSyncTimer();
}

let feishuSyncTimer = null;

/**
 * 启动飞书同步定时器（只启动一次，避免重复注册）
 */
function startFeishuSyncTimer()
{
	if(feishuSyncTimer) return;
	feishuSyncTimer = setInterval(function() {
		sendFeishuData();
	},5000);
}

function initOtherActon()
{
	startFeishuSyncTimer();

	getSearchVideoData().then(() => {
		let dataNums = updateDownloadButtonVideoCount();
		if(downloadNums > 0 && dataNums < downloadNums){
			logMsg(`已采集 ${dataNums}/${downloadNums} 条，继续下滑加载更多…`, 'info');
			// 屏幕下滑一段距离
			window.scrollBy(0, 200);
			// 再次调用自身
			setTimeout(initOtherActon, 1500);
		} else {
			logMsg(`采集完成，共 ${dataNums} 条，可点击「导出 CSV」保存`, 'success');
		}
    });
}

let promptHideTimer = null;

/**
 * 初始化提示 Toast（顶部滑入）
 */
function initPromptMessagePopup()
{
	if(document.getElementById('nmx_xhs_popup')) return;
	const toast = document.createElement("div");
	toast.id = "nmx_xhs_popup";
	toast.className = "xhs-toast";
	toast.innerHTML =
		"<span class=\"xhs-toast-icon\"></span>" +
		"<span id=\"nmx_xhs_popup_message\" class=\"xhs-toast-msg\"></span>" +
		"<button id=\"nmx_xhs_close_popupbtn\" class=\"xhs-toast-close\" aria-label=\"关闭\">&times;</button>";
	document.body.appendChild(toast);

	document.getElementById('nmx_xhs_close_popupbtn').addEventListener('click', function (){
		hidePromptMessagePopup();
	});
}

function hidePromptMessagePopup() {
	const toast = document.getElementById('nmx_xhs_popup');
	if(toast) toast.classList.remove('show');
}

// 显示提示 Toast；type=2 时 3 秒后自动消失且不显示关闭按钮
function showPromptMessagePopup(message, type = 1) {
	const toast = document.getElementById('nmx_xhs_popup');
	if(!toast) return;
	document.getElementById('nmx_xhs_popup_message').textContent = message;
	const closeButton = document.getElementById('nmx_xhs_close_popupbtn');

	if(promptHideTimer) { clearTimeout(promptHideTimer); promptHideTimer = null; }
	toast.classList.add('show');

	if(type == 2) {
		closeButton.style.display = 'none';
		promptHideTimer = setTimeout(hidePromptMessagePopup, 3000);
	} else {
		closeButton.style.display = '';
	}
}

/**
 * 引入css文件
 * @param url
 */
function addStylesheet(url) {
	const linkElement = document.createElement("link");
	linkElement.rel = "stylesheet";
	linkElement.type = "text/css";
	linkElement.href = chrome.runtime.getURL(url);
	document.head.appendChild(linkElement);
}

/**
 * 数据下载：把已采集数据导出为 CSV
 */
function startDataDownload()
{
	if(tableHeader.length == 0) initTableInfo();
	let listData = [];
	let pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile" || pageType == "explore_result_note")
	{
		listData = downloadData;
	}
	else if(pageType == "search_result_user")
	{
		listData = downloadUserData;
	}
	if(listData.length == 0)
	{
		logMsg('暂无可导出的数据，请先点击「开始采集」', 'warn');
		return;
	}
	let csvContent = convertToCSVContent(listData,tableHeader,tableKeys);
	downloadCsv(csvContent);
	logMsg(`已导出 ${listData.length} 条数据到 CSV`, 'success');
}

/**
 * 获取页面类型
 * @returns {string}
 */
function getPageType()
{
	let currentUrl = window.location.href;
	if(currentUrl.includes("https://www.xiaohongshu.com/search_result"))
	{
		return currentUrl.includes("search_type=user") ? "search_result_user" : "search_result_note";
	}
	if(currentUrl.includes("https://www.xiaohongshu.com/user/profile"))
	{
		return "user_profile";
	}
	if(currentUrl.includes("https://www.xiaohongshu.com/explore"))
	{
		return "explore_result_note";
	}
	return '';
}

/**
 * 更新侧边栏采集数量统计
 */
function updateDownloadButtonVideoCount()
{
	let dataNums = getSearchVideoCount();
	sendStat(dataNums);
	saveCollected();
	return dataNums;
}

/**
 * 获取搜索页视频数量
 * @returns {number}
 */
function getSearchVideoCount()
{
	let pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile" || pageType == "explore_result_note")
	{
		return downloadData.length;
	}
	else if(pageType == "search_result_user")
	{
		return downloadUserData.length;
	}
	return 0;
}

/**
 * 获取搜索页视频数据
 * @returns {*[]}
 */
async function getSearchVideoData()
{
	let pageType;
	let items;
	pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile" || pageType == "explore_result_note") {
		items = document.querySelectorAll("div.feeds-container section");
		for (let i = 0; i < items.length; i++) {
			let node = items[i];
			// 操作每个节点的代码
			let authorItem = node.querySelector("a.author");
			let titleItem = node.querySelector("a.title");
			let linkItem = node.querySelector("a.cover");
			let likeItem = node.querySelector("span.like-wrapper span.count");
			if(authorItem && linkItem)
			{
				let author = authorItem.innerText;
				let userUrl = authorItem.href;
				let title = titleItem ? titleItem.innerText : "";
				let url = linkItem.href;
				let likeText = likeItem ? likeItem.innerText : "0";
				likeText = likeText.trim() == "赞" ? "0" : likeText;
				let likeNums = convertToNumber(likeText);

				if(downloadData.some(item => item["url"] === url)) continue;

				if(downloadNums > 0 && downloadData.length >= downloadNums) break;

				linkItem.click();
				await new Promise(resolve => setTimeout(resolve, timeInterval * 1000));
				let chatText = "0";
				let chatNums = 0;
				let collectText = "0";
				let collectNums = 0;
				let desc = "";
				let tags = "";
				let date = "";
				let datetime = "";
				let noteContainer = document.querySelector("div#noteContainer");
				if(noteContainer) {
					let descElement = noteContainer.querySelector("div#detail-desc");
					if(descElement) {
						desc = descElement.innerText;
						//获取 a.class=tag 的元素内容，空格分割
						let tagsArr = [];
						let tagElements = noteContainer.querySelectorAll("a.tag");
						tagElements.forEach((tagElement) => {
							tagsArr.push(tagElement.innerText);
						});
						tags = tagsArr.join(" ");
					}
					

					//获取收藏数
					let colletcElement = noteContainer.querySelector("span#note-page-collect-board-guide");
					if(colletcElement) {
						collectText = colletcElement.innerText;
						collectText = collectText.trim() == "收藏" ? "0" : collectText;
					}
					collectNums = convertToNumber(collectText);
					//获取评论数
					let chatElement = noteContainer.querySelector("span.chat-wrapper");
					if(chatElement) {
						chatText = chatElement.innerText;
						chatText = chatText.trim() == "评论" ? "0" : chatText;
					}
					chatNums = convertToNumber(chatText);

					//获取日期
					let dateElement = noteContainer.querySelector("span.date");
					if(dateElement) {
						date = dateElement.innerText;
						datetime = parseDate(date);
					}
				}
				
				document.querySelector("div.close-circle").click();

				await new Promise(resolve => setTimeout(resolve, 1000));
				let dataItem = {
					"author": author,
					"author_url": userUrl,
					"title": title,
					"desc": desc,
					"tags": tags,
					"url": url,
					"like_text": likeText,
					"like_nums": `${likeNums}`,
					"collect_text":collectText,
					"collect_nums": `${collectNums}`,
					"chat_text": chatText,
					"chat_nums": `${chatNums}`,
					"date": date,
					"datetime": datetime,
				};
				addUniqueData(downloadData,dataItem,'url');
				addUniqueData(batchFeishuData,dataItem,'url');
				logMsg(`已采集(${downloadData.length})：${title || author || '无标题笔记'}`, 'info');
				sendStat(downloadData.length);
			}
		}
	}
	else if(pageType == "search_result_user") {
		downloadUserData = [];
		items = document.querySelectorAll("div.feeds-page div.user-list-item");
		items.forEach((node) => {
			if(downloadNums > 0 && downloadUserData.length >= downloadNums) return;
			// 操作每个节点的代码
			let authorUrlItem = node.querySelector("a");
			let authorItem = node.querySelector("div.user-name-box div.user-name");
			let xhsNoItem = node.querySelector("span.user-desc");
			let descItem = node.querySelectorAll("div.user-desc span.user-desc-box");
			if(authorItem)
			{
				let author = authorItem.innerText;
				let userUrl = authorUrlItem.href;
				let xhsNo = xhsNoItem.innerText.trim().replace("小红书号：","");
				let fansItem = getMatchingDOMElement(descItem,"粉丝");
				let fansText = fansItem ? fansItem.innerText.trim().replace("粉丝・","") : "";
				let fansNums = convertToNumber(fansText);
				let noteItem = getMatchingDOMElement(descItem,"笔记");
				let noteNums = noteItem ? noteItem.innerText.trim().replace("笔记・","") : "";
				let dataItem = {
					"author": author,
					"author_url": userUrl,
					"xhs_no": xhsNo,
					"fans_text": fansText,
					"fans_nums": fansNums,
					"note_nums": noteNums,
				};
				downloadUserData.push(dataItem);
				batchFeishuData.push(dataItem);
			}
		});
		logMsg(`已采集 ${downloadUserData.length} 个用户`, 'info');
		sendStat(downloadUserData.length);
	}
}

async function getCurrentNodeData(){
	// 单篇采集同样受采集数量上限限制（与自动采集累计计算）
	if(downloadNums > 0 && downloadData.length >= downloadNums) {
		logMsg(`已达到采集数量上限(${downloadNums})，单篇采集已跳过`, 'warn');
		showPromptMessagePopup(`已达到采集数量上限(${downloadNums})`, 2);
		return;
	}
	let likeText = "0";
	let chatText = "0";
	let chatNums = 0;
	let collectText = "0";
	let collectNums = 0;
	let desc = "";
	let tags = "";
	let date = "";
	let datetime = "";
	let author = "";
	let userUrl = "";
	let title = "";
	let url = "";
	
	let noteContainer = document.querySelector("div#noteContainer");

	if(noteContainer) {

		let authorContainer= noteContainer.querySelector("div.author-container");
		let titleItem = noteContainer.querySelector("div#detail-title");
		let authorItem = authorContainer.querySelector("a.name");
		author = authorItem.textContent;
		userUrl = authorItem.href;
		title = titleItem ? titleItem.innerText : "";
		url = window.location.href;
		let descElement = noteContainer.querySelector("div#detail-desc");
		if(descElement) {
			desc = descElement.innerText;
			//获取 a.class=tag 的元素内容，空格分割
			let tagsArr = [];
			let tagElements = noteContainer.querySelectorAll("a.tag");
			tagElements.forEach((tagElement) => {
				tagsArr.push(tagElement.innerText);
			});
			tags = tagsArr.join(" ");
		}
		let interactContainer = noteContainer.querySelector("div.interact-container");
		//获取点赞数
		let likeElement = interactContainer.querySelector("span.like-wrapper");
		if(likeElement) {
			likeText = likeElement.innerText;
			likeText = likeText.trim() == "赞" ? "0" : likeText;
		}
		let likeNums = convertToNumber(likeText);

		//获取收藏数
		let colletcElement = interactContainer.querySelector("span#note-page-collect-board-guide");
		if(colletcElement) {
			collectText = colletcElement.innerText;
			collectText = collectText.trim() == "收藏" ? "0" : collectText;
		}
		collectNums = convertToNumber(collectText);
		//获取评论数
		let chatElement = interactContainer.querySelector("span.chat-wrapper");
		if(chatElement) {
			chatText = chatElement.innerText;
			chatText = chatText.trim() == "评论" ? "0" : chatText;
		}
		chatNums = convertToNumber(chatText);

		//获取日期
		let dateElement = noteContainer.querySelector("span.date");
		if(dateElement) {
			date = dateElement.innerText;
			datetime = parseDate(date);
		}
		let dataItem = {
			"author": author,
			"author_url": userUrl,
			"title": title,
			"desc": desc,
			"tags": tags,
			"url": url,
			"like_text": likeText,
			"like_nums": `${likeNums}`,
			"collect_text":collectText,
			"collect_nums": `${collectNums}`,
			"chat_text": chatText,
			"chat_nums": `${chatNums}`,
			"date": date,
			"datetime": datetime,
		};
		addUniqueData(downloadData,dataItem,'url');
		updateDownloadButtonVideoCount();
		logMsg(`已采集单篇：${title || author || '无标题笔记'}`, 'success');
		await addFeishuData(dataItem);
	} else {
		logMsg('未找到笔记内容，请在笔记详情页再试', 'error');
		showPromptMessagePopup("未找到笔记内容",2);
	}
}

function addUniqueData(arr, newData,key) {
	if (!arr.some(item => item[key] === newData[key])) {
		arr.push(newData);
	}
}

function getMatchingDOMElement(items, targetText) {
	// 遍历DOM对象数组
	for (const node of items) {
		// 获取节点中的文本内容
		const textContent = node.textContent;

		// 判断文本内容是否包含目标文案
		if (textContent.includes(targetText)) {
			// 如果包含目标文案，直接返回匹配的DOM节点
			return node;
		}
	}

	// 如果没有匹配到任何对象，则返回null或其他适当的值
	return null;
}

/**
 * 点赞量转数字
 * @param str
 * @returns {number|number}
 */
function convertToNumber(str) {
	const match = str.match(/(\d+(\.\d+)?)/);
	if (match) {
		const num = parseFloat(match[1]);
		return (str.includes("w") || str.includes("万")) ? num * 10000 : num;
	}
	return str;
}

/**
 * 格式化csv内容特殊字符
 * @param value
 * @returns {string}
 */
function formatCSVValue(value) {
	if (typeof value === 'string') {
		if (/[",\n\t]/.test(value)) {
			value = value.replace(/"/g, '""');
			value = `"${value}"`;
		}
	}
	return value;
}

function parseDate(input) {
    const today = new Date();

    // 1. 判断是否包含 yyyy-mm-dd 格式
    const fullDatePattern = /\b(\d{4}-\d{2}-\d{2})\b/;
    const fullDateMatch = input.match(fullDatePattern);
    if (fullDateMatch) {
		const date = new Date(fullDateMatch[1]);
		date.setHours(0, 0, 0);
        return formatDateTime(date);
    }

    // 2. 判断是否包含 mm-dd 格式
    const monthDayPattern = /\b(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/;
    const monthDayMatch = input.match(monthDayPattern);
    if (monthDayMatch) {
        const [month, day] = monthDayMatch[0].split('-').map(Number);
        const date = new Date(today.getFullYear(), month - 1, day);
		date.setHours(0, 0, 0);
        return formatDateTime(date);
    }

    // 3. 判断是否包含 N 天前
    const daysAgoPattern = /(\d+) 天前/;
    const daysMatch = input.match(daysAgoPattern);
    if (daysMatch) {
        const daysAgo = parseInt(daysMatch[1], 10);
        const pastDate = new Date(today);
        pastDate.setDate(today.getDate() - daysAgo);
		pastDate.setHours(0, 0, 0);
        return formatDateTime(pastDate);
    }

    // 4. 判断是否包含昨天+时分
    const yesterdayPattern = /昨天 (\d{2}:\d{2})/;
    const yesterdayMatch = input.match(yesterdayPattern);
    if (yesterdayMatch) {
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const [hours, minutes] = yesterdayMatch[1].split(':');
        yesterday.setHours(Number(hours), Number(minutes), 0);
        return formatDateTime(yesterday);
    }

    // 5. 判断是否包含今天+时分
    const todayPattern = /今天 (\d{2}:\d{2})/;
    const todayMatch = input.match(todayPattern);
    if (todayMatch) {
        const todayWithTime = new Date(today);
        const [hours, minutes] = todayMatch[1].split(':');
        todayWithTime.setHours(Number(hours), Number(minutes), 0);
        return formatDateTime(todayWithTime);
    }

    // 如果没有匹配到，返回 null
    return null;
}

function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 把数组转换成csv内容
 * @param data
 * @returns {string}
 */
function convertToCSVContent(data,header=[],keysArr = []) {
	let pHeader = header.length == 0 ? ["作者", "标题", "点赞文本", "点赞数量", "视频地址", "日期"] : header;
	let pKeysArr = keysArr.length ==0 ? ["auther", "title", "like_text", "like_nums", "video_url", "date_str"] : keysArr;
	const rows = data.map(row => pKeysArr.map(key => formatCSVValue(row[key])).join(","));
	return [pHeader.join(",")].concat(rows).join("\n");
}

function initSetting(callback)
{
    // 获取存储的值
    chrome.storage.local.get('nmx_xhs_setting', function (data) {
		function getSettingValue(key,defaultValue = '') {
			return (data.hasOwnProperty("nmx_xhs_setting") && data.nmx_xhs_setting.hasOwnProperty(key)) ? data.nmx_xhs_setting[key] : defaultValue;
		}
        downloadNums = parseInt(getSettingValue("download_nums",30));
		timeInterval = parseInt(getSettingValue("time_interval",1));
        feishuAppId = getSettingValue("app_id","");
		feishuAppSecret = getSettingValue("app_secret","");
		feishuAppToken = getSettingValue("app_token","");
		feishuTableId = getSettingValue("table_id","");
        if(callback) callback();
    });
}

// 初始化：引入CSS、读取设置、创建提示弹层。
// 兼容两种注入方式：manifest 页面加载注入 与 sidepanel 按需注入（晚于 onload）。
function initXhs() {
	if(window.__xhsInited) return;
	if(!currentDomain.includes("www.xiaohongshu.com")) return;
	window.__xhsInited = true;
	initPromptMessagePopup();
	initSetting();
	loadCollected(function() { sendStat(getSearchVideoCount()); });
	addStylesheet("css/page_layer.css");
}
if(document.readyState === 'complete' || document.readyState === 'interactive') {
	initXhs();
} else {
	window.addEventListener('DOMContentLoaded', initXhs);
	window.addEventListener('load', initXhs);
}
/**
 * 事件监听
 */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	if(message && message.type == 'ping') { sendResponse({ ok: true }); return true; }
	if(message && message.type == 'get_stat') { sendResponse({ count: getSearchVideoCount() }); return true; }
	if(message && message.type == 'clear_data') { clearCollected(); sendResponse({ ok: true }); return true; }
	window.focus();
	if(message.type == 'check_mkey_complete')
	{
		if(message.data && message.data.hasOwnProperty("code") && message.data.code != 0)
		{
			logMsg(message.data.message || '密钥校验未通过', 'error');
			showPromptMessagePopup(message.data.message);
		}
		else
		{
			// 每次操作前重新读取最新设置，确保侧边栏改动即时生效
			initSetting(function() { startDataDownload(); });
		}
	}
	else if(message.type == 'goto_start')
	{
		initSetting(function() { goStart(); });
	}
	else if(message.type == 'download_single_note')
	{
		if(message.data && message.data.hasOwnProperty("code") && message.data.code != 0)
		{
			logMsg(message.data.message || '密钥校验未通过', 'error');
			showPromptMessagePopup(message.data.message);
		}
		else
		{
			initSetting(function() { goStartDownloadSingleNote(); });
		}
	}
});
