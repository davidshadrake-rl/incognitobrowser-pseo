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
export const NICHE_TOOL_MAP: Record<string, { slug: string; title: string; engine: string; description: string }> = {
  'incognito-mode': { slug: 'browser-privacy-audit', title: 'Browser Privacy Audit', engine: 'browser-privacy', description: 'Analyze your browser\'s privacy settings, fingerprinting exposure, and tracking vulnerabilities in real-time.' },
  'browser-privacy': { slug: 'browser-privacy-audit', title: 'Browser Privacy Audit', engine: 'browser-privacy', description: 'Run a comprehensive privacy audit on your current browser to identify tracking vulnerabilities and fingerprinting risks.' },
  'ad-tracking': { slug: 'cookie-tracker-scanner', title: 'Cookie & Tracker Scanner', engine: 'cookie-analyzer', description: 'Scan and categorize cookies on any webpage to identify advertising trackers, analytics scripts, and privacy-invasive cookies.' },
  'cookie-management': { slug: 'cookie-analyzer', title: 'Cookie Analyzer', engine: 'cookie-analyzer', description: 'Analyze browser cookies to identify tracking cookies, categorize them by purpose, and understand their privacy impact.' },
  'device-fingerprinting': { slug: 'fingerprint-checker', title: 'Browser Fingerprint Checker', engine: 'browser-privacy', description: 'Detect how websites fingerprint your browser through canvas rendering, WebRTC, screen resolution, and other techniques.' },
  'digital-footprint': { slug: 'privacy-score-quiz', title: 'Privacy Score Calculator', engine: 'privacy-quiz', description: 'Take a comprehensive privacy assessment to calculate your digital footprint score and get personalized recommendations.' },
  'vpn-privacy': { slug: 'browser-leak-test', title: 'Browser Leak Test', engine: 'browser-privacy', description: 'Check for WebRTC leaks, DNS leaks, and other browser vulnerabilities that could expose your real IP while using a VPN.' },
  'password-security': { slug: 'password-strength-checker', title: 'Password Strength Checker', engine: 'password-strength', description: 'Analyze your password\'s strength with entropy calculation, crack time estimation, pattern detection, and security recommendations.' },
  'encrypted-messaging': { slug: 'text-encryption-tool', title: 'Text Encryption Tool', engine: 'text-encryption', description: 'Encrypt and decrypt text messages using military-grade AES-256-GCM encryption, entirely in your browser.' },
  'private-search': { slug: 'browser-privacy-audit', title: 'Search Privacy Audit', engine: 'browser-privacy', description: 'Audit your browser\'s privacy settings to ensure your search activity isn\'t being tracked or logged.' },
  'data-brokers': { slug: 'digital-privacy-score', title: 'Digital Privacy Score', engine: 'privacy-quiz', description: 'Assess how exposed your personal data is to data brokers with this comprehensive privacy quiz.' },
  'isp-tracking': { slug: 'browser-leak-test', title: 'ISP Tracking Detector', engine: 'browser-privacy', description: 'Detect browser settings and leaks that allow your ISP to track your online activity.' },
  'location-tracking': { slug: 'permission-audit', title: 'Location Permission Audit', engine: 'permission-checker', description: 'Check which websites and apps have access to your location data and other sensitive device permissions.' },
  'public-wifi': { slug: 'browser-security-check', title: 'Public WiFi Security Check', engine: 'browser-privacy', description: 'Audit your browser\'s security configuration to identify vulnerabilities when using public WiFi networks.' },
  'phishing': { slug: 'url-safety-checker', title: 'URL Safety Checker', engine: 'url-analyzer', description: 'Analyze any URL for phishing indicators, suspicious patterns, and security risks before clicking.' },
  'malware-protection': { slug: 'url-safety-scanner', title: 'URL Safety Scanner', engine: 'url-analyzer', description: 'Scan URLs for malware indicators, suspicious redirects, and known phishing patterns.' },
  'email-privacy': { slug: 'privacy-score-quiz', title: 'Email Privacy Score', engine: 'privacy-quiz', description: 'Evaluate your email privacy practices and get recommendations for protecting your inbox.' },
  'social-media-privacy': { slug: 'social-privacy-quiz', title: 'Social Media Privacy Quiz', engine: 'privacy-quiz', description: 'Assess your social media privacy practices and learn how to reduce your digital exposure.' },
  'online-shopping': { slug: 'url-safety-checker', title: 'Shopping URL Verifier', engine: 'url-analyzer', description: 'Verify if an online store URL is legitimate before entering your payment information.' },
  'online-banking': { slug: 'password-strength-checker', title: 'Banking Password Checker', engine: 'password-strength', description: 'Ensure your banking passwords meet security standards with real-time strength analysis and breach detection.' },
  'workplace-privacy': { slug: 'browser-privacy-audit', title: 'Workplace Browser Audit', engine: 'browser-privacy', description: 'Check what information your work browser reveals to employers and third-party monitors.' },
  'student-privacy': { slug: 'digital-privacy-quiz', title: 'Student Privacy Quiz', engine: 'privacy-quiz', description: 'Evaluate your digital privacy habits as a student and learn to protect your academic data.' },
  'children-safety': { slug: 'permission-checker', title: 'Device Permission Checker', engine: 'permission-checker', description: 'Review device permissions to ensure children\'s apps aren\'t accessing camera, microphone, or location data.' },
  'healthcare-privacy': { slug: 'text-encryption-tool', title: 'Medical Data Encryption', engine: 'text-encryption', description: 'Encrypt sensitive healthcare information using AES-256 encryption before sharing digitally.' },
  'dating-privacy': { slug: 'image-metadata-checker', title: 'Photo Metadata Checker', engine: 'metadata-viewer', description: 'Check photos for hidden metadata like GPS coordinates and camera info before sharing on dating apps.' },
  'smart-home-privacy': { slug: 'permission-audit', title: 'Smart Device Permission Audit', engine: 'permission-checker', description: 'Audit browser permissions that smart home devices and their web interfaces may be accessing.' },
  'webcam-privacy': { slug: 'permission-checker', title: 'Webcam Permission Checker', engine: 'permission-checker', description: 'Check which websites have access to your camera and microphone, and learn how to revoke permissions.' },
  'ai-privacy': { slug: 'browser-privacy-audit', title: 'AI Privacy Audit', engine: 'browser-privacy', description: 'Audit your browser for data leaks that AI-powered trackers exploit for profiling.' },
  'cloud-privacy': { slug: 'text-encryption-tool', title: 'Cloud Data Encryption', engine: 'text-encryption', description: 'Encrypt sensitive files and text before uploading to cloud storage using client-side AES-256 encryption.' },
  'gaming-privacy': { slug: 'useragent-analyzer', title: 'Gaming Browser Analyzer', engine: 'useragent-analyzer', description: 'Analyze what your browser reveals to gaming platforms about your device and system configuration.' },
  'gdpr': { slug: 'cookie-compliance-scanner', title: 'Cookie Compliance Scanner', engine: 'cookie-analyzer', description: 'Scan cookies on any website to check for GDPR compliance issues and unauthorized tracking.' },
  'ccpa': { slug: 'cookie-privacy-scanner', title: 'Cookie Privacy Scanner', engine: 'cookie-analyzer', description: 'Analyze website cookies for CCPA compliance and identify data collection practices.' },
  'us-state-privacy': { slug: 'privacy-compliance-quiz', title: 'Privacy Compliance Quiz', engine: 'privacy-quiz', description: 'Test your knowledge of US state privacy laws and assess your organization\'s compliance readiness.' },
  'international-privacy': { slug: 'privacy-law-quiz', title: 'International Privacy Quiz', engine: 'privacy-quiz', description: 'Evaluate your understanding of international privacy regulations and their requirements.' },
  'data-breach': { slug: 'password-strength-checker', title: 'Post-Breach Password Checker', engine: 'password-strength', description: 'Check if your passwords are strong enough after a data breach — analyze strength and detect common patterns.' },
  'right-to-forget': { slug: 'digital-footprint-quiz', title: 'Digital Footprint Quiz', engine: 'privacy-quiz', description: 'Assess your digital footprint and learn what data you have the right to request deletion of.' },
  'privacy-policies': { slug: 'cookie-tracker-analyzer', title: 'Website Cookie Analyzer', engine: 'cookie-analyzer', description: 'Analyze website cookies to verify they match the site\'s stated privacy policy.' },
  'crypto-privacy': { slug: 'hash-generator', title: 'Cryptographic Hash Generator', engine: 'hash-generator', description: 'Generate SHA-256, SHA-384, SHA-512, and SHA-1 hashes for verifying file integrity and data authenticity.' },
  'tor-privacy': { slug: 'browser-fingerprint-test', title: 'Browser Fingerprint Test', engine: 'browser-privacy', description: 'Test your Tor browser\'s fingerprint resistance and check for potential identity leaks.' },
  'facial-recognition': { slug: 'image-metadata-stripper', title: 'Photo Metadata Viewer', engine: 'metadata-viewer', description: 'View and understand metadata in your photos that facial recognition systems could use to identify you.' },
  'drone-surveillance': { slug: 'image-metadata-checker', title: 'Image Metadata Inspector', engine: 'metadata-viewer', description: 'Inspect drone and aerial photos for embedded GPS coordinates, camera data, and other identifying metadata.' },
  'browser-extensions': { slug: 'browser-security-audit', title: 'Browser Security Audit', engine: 'browser-privacy', description: 'Audit your browser\'s security posture including extension detection vectors and fingerprinting surface.' },
  'journalist-privacy': { slug: 'secure-text-encryption', title: 'Secure Text Encryption', engine: 'text-encryption', description: 'Encrypt sensitive communications with AES-256-GCM encryption — designed for journalists protecting sources.' },
  'search-history': { slug: 'privacy-habits-quiz', title: 'Search Privacy Quiz', engine: 'privacy-quiz', description: 'Evaluate your search privacy habits and learn how to prevent your search history from being tracked.' },
};
