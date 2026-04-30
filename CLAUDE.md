# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status

This is a practice/learning repository for Claude Code. It currently contains only Claude Code configuration and no application code.

## Configuration

`.claude/settings.local.json` grants the following pre-approved permissions:
- `PowerShell(git *)` — git commands via PowerShell
- `PowerShell(winget install *)` — package installation via winget
- `PowerShell(code *)` — VS Code commands via PowerShell

## Platform Notes

- Shell: bash syntax preferred (forward slashes, `/dev/null`), PowerShell also available
- OS: Windows 11 — use the PowerShell tool when Windows-native behavior is needed
