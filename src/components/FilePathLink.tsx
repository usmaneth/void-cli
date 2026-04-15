import React from 'react'
import { pathToFileURL } from 'url'
import * as path from 'path'
import Link from '../ink/components/Link.js'
import { Text, Box } from '../ink.js'

type Props = {
  /** The absolute file path */
  filePath: string
  /** Optional display text (defaults to formatted filePath) */
  children?: React.ReactNode
}

/**
 * Renders a file path as an OSC 8 hyperlink.
 * Highlights the filename and dims the directory path.
 */
export function FilePathLink({ filePath, children }: Props): React.ReactNode {
  const url = pathToFileURL(filePath).href
  
  if (children) {
    return <Link url={url}>{children}</Link>
  }

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  
  // If it's just a filename with no directory or root
  if (dir === '.' || dir === '/') {
    return (
      <Link url={url}>
        <Text color="ide" underline>{filePath}</Text>
      </Link>
    )
  }

  return (
    <Link url={url}>
      <Text>
        <Text dimColor underline>{dir}/</Text>
        <Text color="ide" bold underline>{base}</Text>
      </Text>
    </Link>
  )
}
