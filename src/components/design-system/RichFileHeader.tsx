import * as React from 'react'
import { Box, Text } from '../../ink.js'
import * as path from 'path'

interface RichFileHeaderProps {
  filePath: string
  lineCount?: number
  stats?: React.ReactNode // e.g. "Added 5 lines, removed 2"
}

export function RichFileHeader({ filePath, lineCount, stats }: RichFileHeaderProps) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()
  
  // Basic language mappings
  const getLangDetails = (ext: string) => {
    switch(ext) {
      case '.ts': case '.tsx': return { icon: '🔷', name: 'TypeScript', color: 'blue' }
      case '.js': case '.jsx': return { icon: '🟡', name: 'JavaScript', color: 'yellow' }
      case '.json': return { icon: '📋', name: 'JSON', color: 'green' }
      case '.md': return { icon: '📝', name: 'Markdown', color: 'white' }
      case '.css': return { icon: '🎨', name: 'CSS', color: 'cyan' }
      case '.html': return { icon: '🌐', name: 'HTML', color: 'orange' }
      case '.py': return { icon: '🐍', name: 'Python', color: 'yellow' }
      case '.rs': return { icon: '🦀', name: 'Rust', color: 'red' }
      case '.go': return { icon: '🐹', name: 'Go', color: 'cyan' }
      default: return { icon: '📄', name: 'File', color: 'white' }
    }
  }
  
  const lang = getLangDetails(ext)

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%" backgroundColor="bashMessageBackgroundColor" paddingX={1} paddingY={0} borderStyle="round" borderColor="inactive">
      <Box flexDirection="row" gap={1}>
        <Text>{lang.icon}</Text>
        <Text>
          {dir !== '.' && dir !== '/' && <Text dimColor>{dir}/</Text>}
          <Text bold color="claude">{base}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" gap={2}>
        {stats && <Box>{stats}</Box>}
        <Text dimColor color={lang.color}>[{lang.name}]</Text>
      </Box>
    </Box>
  )
}
