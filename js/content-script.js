let currentDomain = window.location.hostname;
let currentUrl = window.location.href;
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

/**
 * 初始化弹层
 */
function initDownloadButton() {
	const html = '<div class="gpt-sr-container">\n' +
	'    <div class="gpt-sr-toggle-arrow collapsed">◀</div>\n' + // 将箭头移到外部
	'    <div class="gpt-sr-sidebar collapsed">\n' +
	'      <div class="gpt-sr-button-group">\n' +
	'        <button id="xhs-sr-toggleButton" class="gpt-sr-btn">数据下载</button>\n' +
	'        <button id="xhs-sr-singleButton" class="gpt-sr-btn">单篇下载</button>\n' +
	'      </div>\n' +
	'    </div>\n' +
	'  </div>';
	const popupElement = document.createElement("div");
	popupElement.innerHTML = html;
	document.body.appendChild(popupElement);
	document.querySelector("#xhs-sr-toggleButton").addEventListener("click", function() {
		this.disabled = true;
		chrome.runtime.sendMessage({"type":"check_mkey"}, function (response) {
			console.log(response.farewell)
		});
	});
	// 为单篇下载按钮添加事件监听
	document.querySelector("#xhs-sr-singleButton").addEventListener("click", function() {
		this.disabled = true;
		chrome.runtime.sendMessage({"type":"download_single_note"}, function (response) {
			console.log(response.farewell)
		});
		this.disabled = false;
	});
	
	// 为箭头添加点击事件
	const arrow = document.querySelector(".gpt-sr-toggle-arrow");
	const sidebar = document.querySelector(".gpt-sr-sidebar");
	
	arrow.addEventListener("click", function() {
		sidebar.classList.toggle("collapsed");
		this.classList.toggle("collapsed");
	});
}

function activiteDownloadButton()
{
	document.querySelector("#xhs-sr-toggleButton").disabled = false;
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
				console.log('获取飞书token成功');
			} else {
				console.log('Error:', jsonData);
			}
		} else {
			console.log('Error:', response.message);
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
				console.log('同步飞书数据成功');
			} else {
				console.log('Error:', jsonData);
			}
		} else {
			console.log('Error:', response.message);
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
				console.log('创建飞书表格成功');
			} else {
				console.log('Error:', jsonData);
			}
		} else {
			console.log('Error:', response.message);
		}
	});
}


async function addFeishuData(data) {
	if(!tenantAccessToken || !feishuTableId) return;
	let xhsKey = extractXhsKey(data.url);
	console.log("获取" + xhsKey + "的数据");
	recordIds = [];
	skuIds = [];
	let url = "https://open.feishu.cn/open-apis/bitable/v1/apps/" + feishuAppToken + "/tables/" + feishuTableId + "/records/search?page_size=500";
	await proxyAjaxRequest(url, 'POST', {"Authorization":"Bearer " + tenantAccessToken,"Content-Type":"application/json; charset=utf-8"}, JSON.stringify({"filter":{"conjunction":"and","conditions":[{"field_name": "笔记地址","operator": "contains","value": [xhsKey]}]}}),async function(response) {
		if(!response) return;
		if (response.status === 'success') {
			//response.data 转json
			let jsonData = JSON.parse(response.data);
			console.log(jsonData);
			if(jsonData.code == 0) {
				if(jsonData.data.total > 0) {
					showPromptMessagePopup("已经同步飞书表格",2);
				} else {
					showPromptMessagePopup("同步飞书表格成功",2);
					addUniqueData(downloadData,data,'url');
					addUniqueData(batchFeishuData,data,'url');
					updateDownloadButtonVideoCount();
				}
			} else {
				console.log('Error:', jsonData);
			}
		} else {
			console.log('Error:', response.message);
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
	initTableInfo();
	await getFeishuToken();
	await createFeishuTable();
	initOtherActon();
}

async function goStartDownloadSingleNote() {
	initTableInfo();
	await getFeishuToken();
	await createFeishuTable();
	await getCurrentNodeData();
	setInterval(function() {
		sendFeishuData();
	},5000);
}

function initOtherActon()
{
	setInterval(function() {
		sendFeishuData();
	},5000);

	getSearchVideoData().then(() => {
		let dataNums = updateDownloadButtonVideoCount();
		if(downloadNums > 0 && dataNums < downloadNums){
			// 屏幕下滑一段距离
			window.scrollBy(0, 200);
			// 再次调用自身
			setTimeout(initOtherActon, 1500);
		}
    });
}

/**
 * 初始化提示窗
 */
function initPromptMessagePopup()
{
	let html = "<div id=\"nmx_xhs_popup\" class=\"custom-popup\">\n" +
		"\t\t<div class=\"custom-popup-overlay\"></div>\n" +
		"\t\t<div class=\"custom-popup-content\">\n" +
		"\t\t\t<span id=\"nmx_xhs_popup_message\" class=\"custom-popup-question\"></span>\n" +
		"\t\t\t<button id=\"nmx_xhs_close_popupbtn\" class=\"custom-popup-close-btn\">确认</button>\n" +
		"\t\t</div>\n" +
		"\t</div>";
	const popupElement = document.createElement("div");
	popupElement.innerHTML = html;
	document.body.appendChild(popupElement);
	// 获取弹窗元素
	const popup = document.getElementById('nmx_xhs_popup');
	// 获取关闭按钮元素
	const closeButton = document.getElementById('nmx_xhs_close_popupbtn');

	// 点击关闭按钮关闭弹窗
	closeButton.addEventListener('click', function (){
		popup.style.display = 'none';
	});
}

// 显示弹窗并设置错误提示文字
function showPromptMessagePopup(message,type =1) {
	// 获取弹窗元素
	const popup = document.getElementById('nmx_xhs_popup');
	// 获取错误提示元素
	const errorText = document.getElementById('nmx_xhs_popup_message');
	errorText.textContent = message;
	popup.style.display = 'block';
	if(type == 2)
	{
		// 获取关闭按钮元素
		const closeButton = document.getElementById('nmx_xhs_close_popupbtn');
		closeButton.style.display = 'none';
		setTimeout(function (){
			closeButton.click();
		},3000);
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
 * 开始下载
 */
function startDownload()
{
	startDataDownload();
}

/**
 * 数据下载
 */
function startDataDownload()
{
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
	let csvContent = convertToCSVContent(listData,tableHeader,tableKeys);
	downloadCsv(csvContent);
}

/**
 * 获取页面类型
 * @returns {string}
 */
function getPageType()
{
	currentUrl = window.location.href;
	let pageType = '';
	console.log(currentUrl);
	if(currentUrl.includes("https://www.xiaohongshu.com/search_result"))
	{
		if(currentUrl.includes("search_type=user"))
		{
			pageType = "search_result_user";
		}
		else
		{
			pageType = "search_result_note";
		}
	}
	else if(currentUrl.includes("https://www.xiaohongshu.com/user/profile"))
	{
		pageType = "user_profile";
	}
	else if(currentUrl.includes("https://www.xiaohongshu.com/explore"))
	{
		pageType = "explore_result_note";
	}
	console.log(pageType);
	return pageType;
}

/**
 * 更新按钮统计文案
 */
function updateDownloadButtonVideoCount()
{
	let buttonElement = document.querySelector("#xhs-sr-toggleButton");
	let dataNums = getSearchVideoCount();
	let pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile" || pageType == "explore_result_note")
	{
		buttonElement.textContent = "笔记数据下载(" + dataNums + ")";
	}
	else if(pageType == "search_result_user")
	{
		buttonElement.textContent = "用户数据下载(" + dataNums + ")";
	}
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
		console.log(items.length);
		for (let i = 0; i < items.length; i++) {
			let node = items[i];
			// 操作每个节点的代码
			let authorItem = node.querySelector("a.author");
			let titleItem = node.querySelector("a.title");
			let linkItem = node.querySelector("a.cover");
			let likeItem = node.querySelector("span.like-wrapper span.count");
			if(authorItem)
			{
				let author = authorItem.innerText;
				let userUrl = authorItem.href;
				let title = titleItem ? titleItem.innerText : "";
				let url = linkItem.href;
				let likeText = likeItem.innerText;
				likeText = likeText.trim() == "赞" ? "0" : likeText;
				let likeNums = convertToNumber(likeText);

				if(downloadData.some(item => item["url"] === url)) continue;

				if(downloadNums > 0 && downloadData.length >= downloadNums) break;

				node.querySelector("a.cover").click();
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
				console.log(title);
				addUniqueData(downloadData,dataItem,'url');
				addUniqueData(batchFeishuData,dataItem,'url');
			}
		}
	}
	else if(pageType == "search_result_user") {
		downloadUserData = [];
		items = document.querySelectorAll("div.feeds-page div.user-list-item");
		console.log(items.length);
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
				//console.log(author);
				downloadUserData.push(dataItem);
				batchFeishuData.push(dataItem);
			}
		});
	}
}

async function getCurrentNodeData(){
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
		likeNums = convertToNumber(likeText);

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
		console.log(dataItem);
		await addFeishuData(dataItem);
	} else {
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
		if(str.includes("w"))
		{
			return num * 10000;
		}
		else if(str.includes("万"))
		{
			return num * 10000;
		}
		return num;
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

/**
 * 提取账号
 * @param text
 * @returns {null|*}
 */
function extractIDs(text) {
	const regex = /[\w\-+.]{6,20}/g; // 贪婪匹配，匹配包含字母、数字、下划线、连字符、加号和点号的字符序列
	const matches = text.match(regex);
	if (matches && matches.length > 0) {
		return matches.join("、");
	}
	return null; // 未找到微信号
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
		// 在这里使用存储的值
        console.log(downloadNums);
        if(callback) callback();
    });
}

// 在页面加载完成后插入弹层和引入CSS文件
window.onload = function() {
	if(currentDomain.includes("www.xiaohongshu.com"))
	{
		initPromptMessagePopup();
		initDownloadButton();
		initSetting();
		addStylesheet("css/page_layer.css");
	}
};
/**
 * 事件监听
 */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	window.focus();
	console.log(message.type);
	if(message.type == 'check_mkey_complete')
	{
		activiteDownloadButton();
		if(message.data.hasOwnProperty("code") && message.data.code !=0)
		{
			showPromptMessagePopup(message.data.message);
		}
		else
		{
			startDownload();
		}
	}
	else if(message.type == 'goto_start')
	{
		goStart();
	}
	else if(message.type == 'download_single_note')
	{
		goStartDownloadSingleNote();
	}
});
