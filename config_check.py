#!/usr/bin/env python3
"""
Maids Dashboard Server Entry Point
Manor Control Plane - Task 1
"""

import logging
import argparse
import json
import os
import sys

logger = logging.getLogger(__name__)

import gateway.probe as gateway_probe

from core.utils import get_openclaw_root

def resolve_path(root, relative_path):
    """Resolve a relative path from the OpenClaw root."""
    return os.path.join(root, relative_path)


def check_config(config_path):
    """Verify config.json exists and is valid JSON."""
    if not os.path.exists(config_path):
        return False, f"Config file not found: {config_path}"
    
    try:
        with open(config_path, 'r') as f:
            json.load(f)
    except json.JSONDecodeError as e:
        return False, f"Invalid JSON in config: {e}"
    except Exception as e:
        return False, f"Error reading config: {e}"
    
    return True, None


def check_path_parents(config):
    """Check that parent directories for canonDbPath and eventLogPath exist."""
    root = get_openclaw_root()
    issues = []
    
    # Check canonDbPath parent
    canon_db_path = resolve_path(root, config.get('canonDbPath', ''))
    canon_parent = os.path.dirname(canon_db_path)
    if not os.path.exists(canon_parent):
        # Check if we can create it
        try:
            os.makedirs(canon_parent, exist_ok=True)
        except Exception as e:
            issues.append(f"Cannot create canonDbPath parent directory: {canon_parent} - {e}")
    else:
        if not os.path.isdir(canon_parent):
            issues.append(f"canonDbPath parent exists but is not a directory: {canon_parent}")
    
    # Check eventLogPath parent
    event_log_path = resolve_path(root, config.get('eventLogPath', ''))
    event_parent = os.path.dirname(event_log_path)
    if not os.path.exists(event_parent):
        try:
            os.makedirs(event_parent, exist_ok=True)
        except Exception as e:
            issues.append(f"Cannot create eventLogPath parent directory: {event_parent} - {e}")
    else:
        if not os.path.isdir(event_parent):
            issues.append(f"eventLogPath parent exists but is not a directory: {event_parent}")
    
    if issues:
        return False, "; ".join(issues)
    return True, None


def print_paths(config):
    """Print resolved paths (relative, no secrets)."""
    root = get_openclaw_root()
    
    print("Manor Control Plane - Path Configuration:")
    print(f"  OpenClaw Root: {root}")
    print(f"  Config Path: workspace/maids/config.json")
    print(f"  Canon DB Path: {config.get('canonDbPath', 'N/A')}")
    print(f"  Event Log Path: {config.get('eventLogPath', 'N/A')}")
    print(f"  Dashboard Bind: {config.get('dashboardBindHost', 'N/A')}:{config.get('dashboardPort', 'N/A')}")
    print(f"  Gateway Base URL: {config.get('gatewayBaseUrl', 'N/A')}")
    print(f"  Gateway Auth Mode: {config.get('gatewayAuthMode', 'N/A')}")
    print(f"  Gateway Token Source: {config.get('gatewayTokenSource', 'N/A')}")
    # Note: dashboardSecret is not printed (may be null or contain sensitive data)


def main():
    parser = argparse.ArgumentParser(description='Maids Dashboard Server')
    parser.add_argument('--check', action='store_true', help='Verify configuration and paths')
    args = parser.parse_args()
    
    root = get_openclaw_root()
    config_path = os.path.join(root, 'workspace', 'maids', 'config.json')
    
    if args.check:
        # Check 1: Config exists and valid
        valid, error = check_config(config_path)
        if not valid:
            print(f"ERROR: {error}", file=sys.stderr)
            sys.exit(1)
        
        # Load config
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
        except Exception as e:
            print(f"ERROR: Failed to load config: {e}", file=sys.stderr)
            sys.exit(1)
        
        # Check 2: Path parents exist or can be created
        valid, error = check_path_parents(config)
        if not valid:
            print(f"ERROR: {error}", file=sys.stderr)
            sys.exit(1)

        result = gateway_probe.gateway_health()
        print(f"Gateway Base URL: {config.get('gatewayBaseUrl', 'N/A')}")
        print(f"Gateway healthy: {result.ok}")
        if not result.ok:
            print(f"ERROR: gateway health check failed: {result.error}", file=sys.stderr)
            sys.exit(1)
        print("Gateway health: OK")

        # All checks passed - print paths
        print_paths(config)
        print("\nAll checks passed.")
        sys.exit(0)
    
    # No args, show help or start server (stub)
    parser.print_help()


if __name__ == '__main__':
    main()
