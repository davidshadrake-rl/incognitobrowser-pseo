'use client';

import React from 'react';
import { PasswordStrengthTool } from './PasswordStrengthTool';
import { PasswordGeneratorTool } from './PasswordGeneratorTool';
import { BrowserPrivacyTool } from './BrowserPrivacyTool';
import { TextEncryptionTool } from './TextEncryptionTool';
import { URLAnalyzerTool } from './URLAnalyzerTool';
import { HashGeneratorTool } from './HashGeneratorTool';
import { PrivacyQuizTool } from './PrivacyQuizTool';
import { PermissionCheckerTool } from './PermissionCheckerTool';
import { CookieAnalyzerTool } from './CookieAnalyzerTool';
import { UserAgentAnalyzerTool } from './UserAgentAnalyzerTool';
import { MetadataViewerTool } from './MetadataViewerTool';
import { WhatsMyIpTool } from './WhatsMyIpTool';
import { AdBlockerTestTool } from './AdBlockerTestTool';
import { DnsLeakTestTool } from './DnsLeakTestTool';
import { ScreenshotLeakCheckerTool } from './ScreenshotLeakCheckerTool';
import { EmailPixelDetectorTool } from './EmailPixelDetectorTool';
import { LinkUnwrapperTool } from './LinkUnwrapperTool';

// Maps toolEngine values to their React components
const TOOL_ENGINES: Record<string, React.ComponentType> = {
  'password-strength': PasswordStrengthTool,
  'password-generator': PasswordGeneratorTool,
  'browser-privacy': BrowserPrivacyTool,
  'text-encryption': TextEncryptionTool,
  'url-analyzer': URLAnalyzerTool,
  'hash-generator': HashGeneratorTool,
  'privacy-quiz': PrivacyQuizTool,
  'permission-checker': PermissionCheckerTool,
  'cookie-analyzer': CookieAnalyzerTool,
  'useragent-analyzer': UserAgentAnalyzerTool,
  'metadata-viewer': MetadataViewerTool,
  'whats-my-ip': WhatsMyIpTool,
  'ad-blocker-test': AdBlockerTestTool,
  'dns-leak-test': DnsLeakTestTool,
  'screenshot-leak-checker': ScreenshotLeakCheckerTool,
  'email-pixel-detector': EmailPixelDetectorTool,
  'link-unwrapper': LinkUnwrapperTool,
};

export function getToolEngine(engineId: string): React.ComponentType | null {
  return TOOL_ENGINES[engineId] || null;
}

export function renderToolEngine(engineId: string): React.ReactNode {
  const Component = TOOL_ENGINES[engineId];
  if (!Component) return null;
  return <Component />;
}

// Maps niches to their best-fit tool engine

