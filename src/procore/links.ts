/**
 * Deep links into the Procore web app so the CEO can open the source item.
 * Paths follow the Procore web UI and may need adjusting if Procore changes routes.
 */
export class ProcoreLinks {
  constructor(private readonly webBase: string) {}

  project(projectId: number): string {
    return `${this.webBase}/${projectId}/project/home`;
  }

  schedule(projectId: number): string {
    return `${this.webBase}/${projectId}/project/schedule`;
  }

  rfi(projectId: number, id: number): string {
    return `${this.webBase}/${projectId}/project/rfi/show/${id}`;
  }

  submittal(projectId: number, id: number): string {
    return `${this.webBase}/${projectId}/project/submittal_logs/${id}`;
  }

  punchItem(projectId: number, id: number): string {
    return `${this.webBase}/${projectId}/project/punch_list/${id}`;
  }

  inspection(projectId: number, id: number): string {
    return `${this.webBase}/${projectId}/project/checklists/lists/${id}`;
  }

  budget(projectId: number): string {
    return `${this.webBase}/${projectId}/project/budgets`;
  }

  changeOrder(projectId: number, id: number): string {
    return `${this.webBase}/${projectId}/project/change_order_packages/${id}`;
  }

  dailyLog(projectId: number): string {
    return `${this.webBase}/${projectId}/project/daily_log`;
  }
}
