import {App,  Notice, Plugin, PluginSettingTab, Setting, TFile} from 'obsidian';
import * as fs from "fs";
import * as path from "path";


interface BookXNoteSyncSettings {
	BookXNotePath: string;
	ObsidianPath: string;
	IsIgnoreUnchanged: boolean;
}

const DEFAULT_SETTINGS: BookXNoteSyncSettings = {
	BookXNotePath: "",
	ObsidianPath: "",
	IsIgnoreUnchanged: true,
}


export default class BookXNotePlugin extends Plugin {
	settings: BookXNoteSyncSettings;

	// 右上角菜单
	async onload() {
		await this.loadSettings();
		// This creates an icon in the left ribbon.
		this.addRibbonIcon('scroll-text', 'BookXNote同步所有笔记', (_: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('开始同步BookXNote...');
			syncBookXNote(this)
		});

		// 增加文件设置
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
					if (file instanceof TFile) {
						menu.addItem((item) => {
							item
								.setTitle('BookXNote同步此笔记')
								.setIcon('refresh-cw')
								.onClick(async () => {
									const titleName = file.name.replace(".md", "")
									new Notice(`开始同步BookXNote ${titleName}`);
									const nb = GetFilePropertyByKey(file, "book_x_note_nb")
									// console.log("nb:" + nb);
									if (nb) {
										try {
											await readNotebook(this, nb, titleName)
										} catch (e) {
											new Notice(`${titleName}同步失败:` + e);
										}
									} else {
										new Notice(`${titleName}没有找到对应的属性book_x_note_nb, 请全部更新一次`);
									}
								});
						});
					}
				}
			))


		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'sync',
			name: '同步所有笔记',
			callback: () => {
				new Notice('开始同步BookXNote...');
				syncBookXNote(this)
			}
		});

		this.addCommand({
			id: 'sync-one',
			name: '同步当前笔记',
			callback: () => {
				const activeFile = this.app.workspace.getActiveFile()
				if (activeFile) {
					const titleName = activeFile.name.replace(".md", "")
					new Notice(`开始同步BookXNote ${titleName}`);
					const nb = GetFilePropertyByKey(activeFile, "book_x_note_nb")
					// console.log("nb:" + nb);
					if (nb) {
						readNotebook(this, nb, titleName).then(() => {
							new Notice(`${titleName}同步成功`)
						}).catch((e) => {
							new Notice(`${titleName}同步失败:` + e);
						})
					}
				}
			}
		})
		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new BookXNoteSyncSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// 添加错误处理工具函数
function handleError(error: Error, context: string) {
	console.error(`${context}:`, error);
	new Notice(`错误: ${context} - ${error.message}`);
}

// 修改类型定义，使其更准确
interface BookXNoteManifest {
	notebooks?: Array<NotebookItem>;
}

interface NotebookItem {
	type: number;
	id: string;
	entry: string;
	notebooks?: Array<NotebookItem>; // 添加递归定义
}

// 修改 GetBookFromNoteBook 函数的实现
function GetBookFromNoteBook(mainifestObj: BookXNoteManifest): NotebookItem[] {
	let result: NotebookItem[] = []
	if(!mainifestObj.notebooks){
		return []
	}
	for (const notebook of mainifestObj.notebooks) {
		if (notebook.type === 0){
			result.push(notebook)
		} else {
			const childBooks = GetBookFromNoteBook({ notebooks: notebook.notebooks })
			result = result.concat(childBooks)
		}
	}
	return result
}

// 修改 MarkupObject 接口定义
interface MarkupObject {
	title?: string;
	originaltext?: string;
	content?: string;
	page?: number;
	uuid?: string;
	textblocks?: Array<{
		first: number[];  // 修改类型定义
	}>;
	markups?: MarkupObject[];
}

// 添加路径处理工具函数
function normalizePath(filepath: string): string {
	return filepath.replace(/\\/g, '/');
}

function joinPath(...paths: string[]): string {
	return normalizePath(path.join(...paths));
}

// 添加验证函数
function validateSettings(settings: BookXNoteSyncSettings): void {
	if (!settings.BookXNotePath) {
		throw new Error('BookXNote路径未设置');
	}
	if (!fs.existsSync(settings.BookXNotePath)) {
		throw new Error('BookXNote路径不存在');
	}
}

// 同步函数
async function syncBookXNote(t: BookXNotePlugin) {
	try {
		const notebookDir = t.settings.BookXNotePath
		if (!notebookDir) {
			throw new Error('请设置BookXNote路径');
		}

		const notebookManifest = path.join(notebookDir, "manifest.json")
		if (!fs.existsSync(notebookManifest)) {
			throw new Error('manifest.json文件不存在');
		}

		// 读取json文件
		const manifest = fs.readFileSync(notebookManifest, 'utf8')
		// console.log(manifest);
		// 解析 json文件
		const manifestObj = JSON.parse(manifest)
		// console.log(manifestObj);
		if (!manifestObj.notebooks) {
			new Notice('没有notebooks');
			return
		}
		const bookList = GetBookFromNoteBook(manifestObj);
		const syncPromises = bookList.map(notebook =>
			readNotebook(t, notebook.id, notebook.entry)
				.catch(e => {
					handleError(e, `读取${notebook.entry}失败`);
				})
		);

		await Promise.all(syncPromises);
	} catch (error) {
		handleError(error as Error, '同步笔记失败');
	}
}

// 读取一本书的notebook内容
async function readNotebook(t: BookXNotePlugin, nb: string, entry: string) {
	const cache = new Map<string, any>();

	async function readJsonFile(filePath: string) {
		if (cache.has(filePath)) {
			return cache.get(filePath);
		}
		const content = await fs.promises.readFile(filePath, 'utf8');
		const json = JSON.parse(content);
		cache.set(filePath, json);
		return json;
	}

	const app = t.app
	const notebookDirBase = t.settings.BookXNotePath
	const notebookDir = path.join(notebookDirBase, entry)
	const notebookManifest = path.join(notebookDir, "manifest.json")
	// 读取json文件
	const manifest = fs.readFileSync(notebookManifest, 'utf8')
	// console.log(manifest);
	// 解析 json文件
	const manifestObj = JSON.parse(manifest)
	// console.log(manifestObj)
	const book_uuid = manifestObj.res[0]["uuid"]
	// console.log("书的uuid:" + book_uuid);

	const notebookMarkup = path.join(notebookDir, "markups.json")
	const markup = fs.readFileSync(notebookMarkup, 'utf8')
	// 读取notebookMarup 文件的修改时间
	const markupStat = fs.statSync(notebookMarkup)
	// console.log("markupStat:" + markupStat.mtime);
	// console.log(markup);
	const markupObj = JSON.parse(markup)
	const render = parseMarkupObj(markupObj, 1, nb, book_uuid)

	// 新建文件 并且把内容写入到文件中 如果文件存在，就更改文件
	let localDir = t.settings.ObsidianPath
	if (!localDir) {
		// 本根目录
		localDir = app.vault.getRoot().path
	}
	// 创建文件夹
	await app.vault.adapter.mkdir(localDir)
	// 合并路径
	let filePath = joinPath(localDir, `${entry}.md`);
	let file
	const existFile = await app.vault.adapter.exists(filePath)
	// console.log("文件是否存在:" + existFile)
	let origin_front_matter = {}
	if (existFile) {
		file = app.vault.getFileByPath(filePath)
		if (file) {
			// console.log("文件存在, 进行更改");
			// 读取 origin_front_matter 到 origin_front_matter 中
			const sync_time = GetFilePropertyByKey(file, "book_x_note_sync_time")
			// 如果sync_time存在, 则和文件的修改时间作比较，如果sync_time_date 大于 markupStat.mtime, 则不进行更改
			if (sync_time && t.settings.IsIgnoreUnchanged) {
				// 把时间转换成Date对象
				const sync_time_date = new Date(sync_time)
				// console.log("sync_time_date:" + sync_time_date)
				if (sync_time_date > markupStat.mtime) {
					// 如果sync_time_date 大于 markupStat.mtime, 则不进行更改
					new Notice(`${entry}  没有更新, 不进行更改`)
					return
				}
			}
			// await app.fileManager.processFrontMatter(file, (frontmatter) => {
			// 	origin_front_matter = {...frontmatter}
				// console.log("原来的属性:" + JSON.stringify(origin_front_matter))
			// })
			await app.vault.modify(file, render)
		}
	} else {
		// console.log("文件不存在, 进行创建");
		file = await app.vault.create(filePath, render)
	}
	// 添加属性
	if (file) {
		await app.fileManager.processFrontMatter(file, (frontmatter) => {
			Object.assign(frontmatter, origin_front_matter)
			frontmatter.book_x_note_uuid = book_uuid
			frontmatter.book_x_note_nb = nb
			frontmatter.book_x_note_sync_time = formatDate(new Date());
		})
	}
	new Notice(`${entry}同步成功`)
	// if (file){
	// 	await app.workspace.openLinkText(file.path, "", true)
	// }
}

// 修改 parseMarkupObj 函数中的字符串处理
function parseMarkupObj(markupObj: MarkupObject, headerNumber: number, nb: string, book_uuid: string) {
	let render = ""
	const title = markupObj.title
	if (title && headerNumber > 1) {
		render += `${"#".repeat(headerNumber)} ${title}\n\n`
	}

	let originaltext = markupObj.originaltext
	if (originaltext) {
		// 使用 split 和 join 替代 replaceAll
		originaltext = originaltext.split("\n").join("\n>")
		render += `> ${originaltext}`

		// 添加更严格的类型检查
		const textblocks = markupObj.textblocks
		if (textblocks && textblocks.length > 0) {
			const firstBlock = textblocks[0];
			if (firstBlock && firstBlock.first) {
				const coordinates = firstBlock.first;

				if (coordinates && coordinates.length >= 2) {
					const [x, y] = coordinates;
					const book_link = `bookxnotepro://opennote/?nb=${nb}&book=${book_uuid}&page=${markupObj.page}&x=${x}&y=${y}&id=1&uuid=${markupObj.uuid}`
					const link = `[p${markupObj.page}](${book_link})`

					if (render.endsWith("]")) {
						render += "  "
					}
					render += link
				}
			}
		}
		render += "\n\n"
	}

	const content = markupObj.content
	if (content) {
		render += `${content}\n\n`
	}

	const children = markupObj.markups
	if (children) {
		for (const child of children) {
			render += parseMarkupObj(child, headerNumber + 1, nb, book_uuid)
		}
	}
	return render
}

// 修复 isFileHasProperty 和 GetFilePropertyByKey 中的 this 引用问题
function isFileHasProperty(file: TFile, key: string, app: App) {
	const cache = app.metadataCache.getFileCache(file);
	return cache?.frontmatter && cache.frontmatter[key];
}

function GetFilePropertyByKey(file: TFile, key: string): string | null {
	const cache = this.app.metadataCache.getFileCache(file);
	if (cache?.frontmatter && key in cache.frontmatter) {
		return cache.frontmatter[key];
	}
	return null;
}

// 添加日期处理工具函数
function formatDate(date: Date): string {
	return date.toLocaleString('zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
	});
}

class BookXNoteSyncSettingTab extends PluginSettingTab {
	plugin: BookXNotePlugin;

	constructor(app: App, plugin: BookXNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('BookXNote Path')
			.setDesc('BookXNote笔记路径 (请使用完整路径，例如: /Users/username/Documents/BookXNote/notebooks)')
			.addText(text => text
				.setPlaceholder('输入BookXNote笔记路径')
				.setValue(this.plugin.settings.BookXNotePath)
				.onChange(async (value) => {
					this.plugin.settings.BookXNotePath = value.replace(/\\/g, path.sep);
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Obsidian Path')
			.setDesc('笔记保存到Obsidian的路径 (使用正斜杠 / 作为分隔符)')
			.addText(text => text
				.setPlaceholder('输入笔记保存到Obsidian的相对路径')
				.setValue(this.plugin.settings.ObsidianPath)
				.onChange(async (value) => {
					this.plugin.settings.ObsidianPath = value.replace(/\\/g, '/');
					await this.plugin.saveSettings();
				}))

		new Setting(containerEl)
			.setName('Is Ignore Unchanged')
			.setDesc('是否忽略未修改的文件,通过比对文件的修改时间来判断文件是否修改')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.IsIgnoreUnchanged)
				.onChange(async (value) => {
					this.plugin.settings.IsIgnoreUnchanged = value;
				})
			)
	}
}
