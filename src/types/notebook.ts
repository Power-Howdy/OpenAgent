import type { ImageBlockParam } from './api.js'

export type NotebookCellType = 'code' | 'markdown'

export type NotebookOutputImage = {
  image_data: string
  media_type: ImageBlockParam.Source['media_type']
}

export type NotebookCellSourceOutput = {
  text?: string
  image?: NotebookOutputImage
}

export type NotebookCellSource = {
  cell: number
  cellType: string
  source: string
  language: string
  execution_count?: number | null
  outputs?: NotebookCellSourceOutput[]
}

export type NotebookCellOutput = {
  output_type?: string
  text?: string | string[]
  ename?: string
  evalue?: string
  traceback?: string[]
  data?: Record<string, unknown>
}

export type NotebookCell = {
  cell_type: NotebookCellType | string
  source: string | string[]
  execution_count?: number | null
  outputs?: NotebookCellOutput[]
}

export type NotebookContent = {
  cells: NotebookCell[]
  metadata?: {
    language_info?: { name?: string }
  }
}
