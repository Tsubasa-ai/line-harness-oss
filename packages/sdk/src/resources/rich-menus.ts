import type { HttpClient } from '../http.js'
import type { ApiResponse, RichMenu, CreateRichMenuInput } from '../types.js'

export class RichMenusResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  /**
   * Worker は `?accountId=` でアカウントを選び、無ければ「デフォルト」トークンで LINE を呼ぶ。
   * 有効なアカウントが複数あるとデフォルトが決まらず環境変数のトークンに落ちて 401 になるため、
   * 呼び出し側で accountId を渡せるようにする。
   */
  private withAccount(path: string, accountId?: string): string {
    const id = accountId ?? this.defaultAccountId
    if (!id) return path
    return `${path}${path.includes('?') ? '&' : '?'}accountId=${encodeURIComponent(id)}`
  }

  async list(accountId?: string): Promise<RichMenu[]> {
    const res = await this.http.get<ApiResponse<RichMenu[]>>(this.withAccount('/api/rich-menus', accountId))
    return res.data
  }

  async create(menu: CreateRichMenuInput, accountId?: string): Promise<{ richMenuId: string }> {
    const res = await this.http.post<ApiResponse<{ richMenuId: string }>>(this.withAccount('/api/rich-menus', accountId), menu)
    return res.data
  }

  async delete(richMenuId: string, accountId?: string): Promise<void> {
    await this.http.delete(this.withAccount(`/api/rich-menus/${encodeURIComponent(richMenuId)}`, accountId))
  }

  async setDefault(richMenuId: string, accountId?: string): Promise<void> {
    await this.http.post(this.withAccount(`/api/rich-menus/${encodeURIComponent(richMenuId)}/default`, accountId))
  }

  async uploadImage(richMenuId: string, imageData: string, contentType: string = 'image/png', accountId?: string): Promise<void> {
    await this.http.post(this.withAccount(`/api/rich-menus/${encodeURIComponent(richMenuId)}/image`, accountId), {
      imageData,
      contentType,
    })
  }
}
