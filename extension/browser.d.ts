interface RekindleSender { id?: string; url?: string; frameId?: number; tab?: {id?: number; url?: string} }
interface RekindleStorage { get(key: string): Promise<Record<string, any>>; set(value: Record<string, unknown>): Promise<void>; remove(key: string): Promise<void>; setAccessLevel?(level: string): Promise<void> }
declare const browser: {
  runtime: {id: string; getURL(path: string): string; openOptionsPage(): Promise<void>; sendMessage(message: unknown): Promise<any>; onMessage: {addListener(callback: (message: any, sender: RekindleSender) => any): void}};
  storage: {local: RekindleStorage; session: RekindleStorage};
  action: {onClicked: {addListener(callback: (tab: {id?: number; url?: string}) => void): void}; setBadgeText(details: {text: string; tabId?: number}): Promise<void>; setTitle(details: {title: string; tabId?: number}): Promise<void>};
  tabs: {sendMessage(tabId: number, message: unknown): Promise<any>; create(properties: {url: string}): Promise<unknown>; onRemoved: {addListener(callback: (tabId: number) => void): void}};
  scripting: {executeScript(details: {target: {tabId: number}; files: string[]}): Promise<unknown>};
};
