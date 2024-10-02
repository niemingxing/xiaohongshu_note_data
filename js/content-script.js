let currentDomain = window.location.hostname;
let currentUrl = window.location.href;
let downloadData = [];
let downloadUserData = [];
let downloadNums = 0;
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
		'    <div class="gpt-sr-sidebar">\n' +
		'      <button id="xhs-sr-toggleButton">数据下载</button>\n' +
		'    </div>\n' +
		'  </div>\n' +
		'  \n' +
		'  <div id="gpt-sr-popup" class="gpt-sr-popup">\n' +
		'    <button class="gpt-sr-close-btn">&times;</button>\n' +
		'	 <button class="gpt-sr-starting-btn">开始执行</button>\n' +
		'    <div class="gpt-sr-content">\n' +
		'      <h2 class="gpt-sr-title">关键词列表</h2>\n' +
		'      <ul class="gpt-sr-list">\n' +
		'      </ul>\n' +
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
}

function activiteDownloadButton()
{
	document.querySelector("#xhs-sr-toggleButton").disabled = false;
}

function initOtherActon()
{
	let pageType = getPageType();
	getSearchVideoData().then(() => {
		updateDownloadButtonVideoCount();
		if(downloadNums > 0 && downloadData.length < downloadNums){
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
	let header = [];
	let keys = []
	let pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile")
	{
		listData = downloadData;
		header = ["博主名","博主地址","笔记标题","笔记内容","笔记地址","点赞","点赞数","收藏","收藏数","评论","评论数"];
		keys = ["author","author_url","title","desc","url","like_text","like_nums","collect_text","collect_nums","chat_text","chat_nums"];
	}
	else if(pageType == "search_result_user")
	{
		listData = downloadUserData;
		header = ["博主名","博主地址","小红书号","粉丝","粉丝数","笔记数"];
		keys = ["author","author_url","xhs_no","fans_text","fans_nums","note_nums"];
	}
	let csvContent = convertToCSVContent(listData,header,keys);
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
	if(pageType == "search_result_note" || pageType == "user_profile")
	{
		buttonElement.textContent = "笔记数据下载(" + dataNums + ")";
	}
	else if(pageType == "search_result_user")
	{
		buttonElement.textContent = "用户数据下载(" + dataNums + ")";
	}
}

/**
 * 获取搜索页视频数量
 * @returns {number}
 */
function getSearchVideoCount()
{
	let pageType = getPageType();
	if(pageType == "search_result_note" || pageType == "user_profile")
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
	if(pageType == "search_result_note" || pageType == "user_profile") {
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
				await new Promise(resolve => setTimeout(resolve, 500));

				let noteContainer = document.querySelector("div#noteContainer");
				let desc = noteContainer.querySelector("div#detail-desc").innerText;
				let collectText = noteContainer.querySelector("span#note-page-collect-board-guide").innerText;
				collectText = collectText.trim() == "收藏" ? "0" : collectText;
				let collectNums = convertToNumber(collectText);
				let chatText = noteContainer.querySelector("span.chat-wrapper").innerText;
				chatText = chatText.trim() == "评论" ? "0" : chatText;
				let chatNums = convertToNumber(chatText);
				document.querySelector("div.close-circle").click();

				await new Promise(resolve => setTimeout(resolve, 500));
				let dataItem = {
					"author": author,
					"author_url": userUrl,
					"title": title,
					"desc": desc,
					"url": url,
					"like_text": likeText,
					"like_nums": likeNums,
					"collect_text":collectText,
					"collect_nums": collectNums,
					"chat_text": chatText,
					"chat_nums": chatNums
				};
				console.log(title);
				addUniqueData(downloadData,dataItem,'url');
			}
		}
	}
	else if(pageType == "search_result_user") {
		downloadUserData = [];
		items = document.querySelectorAll("div.feeds-page div.user-list-item");
		console.log(items.length);
		items.forEach((node) => {
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
			}
		});
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
        downloadNums = (data.hasOwnProperty("nmx_xhs_setting") && data.nmx_xhs_setting.hasOwnProperty("download_nums")) ? data.nmx_xhs_setting.download_nums : 0;
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
		initOtherActon();
	}
});
