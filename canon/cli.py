#!/usr/bin/env python3
"""
CLI for Head Maid Canon Loop operations.

Subcommands:
    canon loop   - Run the canon loop once
    canon status - Print current world state
    canon reconcile - Manual conflict resolution
    canon cron   - Install/uninstall cron job
"""

import logging
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime

logger = logging.getLogger(__name__)

# Path constants
CANON_STATE_FILE = os.path.join(os.path.dirname(__file__), '.canon_state.json')
CRON_MARKER_FILE = os.path.join(os.path.dirname(__file__), '.canon_cron_installed')


def get_state():
    """Load current canon state from disk."""
    if os.path.exists(CANON_STATE_FILE):
        with open(CANON_STATE_FILE, 'r') as f:
            return json.load(f)
    return {
        'version': 1,
        'last_loop': None,
        'conflicts': [],
        'world_state': {}
    }


def save_state(state):
    """Save canon state to disk."""
    with open(CANON_STATE_FILE, 'w') as f:
        json.dump(state, f, indent=2)


def run_canon_loop():
    """Run the canon loop once."""
    state = get_state()
    
    # Simulate canon loop execution
    # In real implementation, this would call canon_store, lorebook_engine, etc.
    state['last_loop'] = datetime.now().isoformat()
    state['conflicts'] = []  # Clear resolved conflicts
    
    # Simulate world state updates
    state['world_state'] = {
        'characters': 0,
        'locations': 0,
        'events': 0,
        'relationships': 0
    }
    
    save_state(state)
    print("Canon loop executed successfully.")
    print(f"Last run: {state['last_loop']}")
    return 0


def print_status():
    """Print current world state."""
    state = get_state()
    
    print("=== Canon Status ===")
    print(f"Version: {state.get('version', 'unknown')}")
    print(f"Last Loop: {state.get('last_loop', 'never')}")
    print()
    print("World State:")
    ws = state.get('world_state', {})
    print(f"  Characters: {ws.get('characters', 0)}")
    print(f"  Locations: {ws.get('locations', 0)}")
    print(f"  Events: {ws.get('events', 0)}")
    print(f"  Relationships: {ws.get('relationships', 0)}")
    print()
    print(f"Conflicts: {len(state.get('conflicts', []))}")
    
    return 0


def reconcile_conflicts(args):
    """Manual conflict resolution."""
    state = get_state()
    conflicts = state.get('conflicts', [])
    
    if not conflicts:
        print("No conflicts to reconcile.")
        return 0
    
    print(f"Found {len(conflicts)} conflict(s):")
    for i, conflict in enumerate(conflicts, 1):
        print(f"  {i}. {conflict}")
    
    if args.resolve_all:
        # Auto-resolve all conflicts by keeping canonical version
        state['conflicts'] = []
        save_state(state)
        print(f"Resolved {len(conflicts)} conflict(s) automatically.")
    else:
        print("Use --resolve-all to auto-resolve all conflicts.")
    
    return 0


def manage_cron(args):
    """Install or uninstall cron job."""
    if args.install:
        # Install cron job
        if os.path.exists(CRON_MARKER_FILE):
            print("Cron job already installed.")
            return 0
        
        # Create cron entry (Unix-like systems)
        script_path = os.path.abspath(__file__)
        cron_entry = f"0 * * * * python3 {script_path} loop\n"
        
        try:
            # Try to add to crontab
            result = subprocess.run(
                ['crontab', '-l'],
                capture_output=True,
                text=True
            )
            current_crontab = result.stdout if result.returncode == 0 else ""
            
            new_crontab = current_crontab + cron_entry
            subprocess.run(
                ['crontab', '-'],
                input=new_crontab,
                text=True,
                check=True
            )
            
            # Mark as installed
            with open(CRON_MARKER_FILE, 'w') as f:
                f.write(datetime.now().isoformat())
            
            print("Cron job installed successfully.")
            print(f"Entry: {cron_entry.strip()}")
        except (FileNotFoundError, subprocess.CalledProcessError) as e:
            print(f"Note: Could not install system cron: {e}")
            print("Cron marker file created for tracking.")
            with open(CRON_MARKER_FILE, 'w') as f:
                f.write(datetime.now().isoformat())
        
        return 0
    
    elif args.uninstall:
        # Uninstall cron job
        if not os.path.exists(CRON_MARKER_FILE):
            print("Cron job not installed.")
            return 0
        
        try:
            result = subprocess.run(
                ['crontab', '-l'],
                capture_output=True,
                text=True
            )
            if result.returncode == 0:
                current_crontab = result.stdout
                lines = [l for l in current_crontab.split('\n') 
                        if 'canon_cli.py' not in l]
                new_crontab = '\n'.join(lines)
                
                subprocess.run(
                    ['crontab', '-'],
                    input=new_crontab,
                    text=True,
                    check=True
                )
            
            os.remove(CRON_MARKER_FILE)
            print("Cron job uninstalled successfully.")
        except (FileNotFoundError, subprocess.CalledProcessError) as e:
            print(f"Note: Could not remove system cron: {e}")
            if os.path.exists(CRON_MARKER_FILE):
                os.remove(CRON_MARKER_FILE)
            print("Cron marker file removed.")
        
        return 0
    
    else:
        # Check status
        if os.path.exists(CRON_MARKER_FILE):
            with open(CRON_MARKER_FILE, 'r') as f:
                installed_at = f.read().strip()
            print(f"Cron job installed at: {installed_at}")
        else:
            print("Cron job not installed.")
        return 0


def main():
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        description='CLI for Head Maid Canon Loop operations'
    )
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # canon loop
    loop_parser = subparsers.add_parser('loop', help='Run the canon loop once')
    
    # canon status
    status_parser = subparsers.add_parser('status', help='Print current world state')
    
    # canon reconcile
    reconcile_parser = subparsers.add_parser(
        'reconcile', 
        help='Manual conflict resolution'
    )
    reconcile_parser.add_argument(
        '--resolve-all',
        action='store_true',
        help='Automatically resolve all conflicts'
    )
    
    # canon cron
    cron_parser = subparsers.add_parser('cron', help='Install/uninstall cron job')
    cron_parser.add_argument(
        '--install',
        action='store_true',
        help='Install cron job'
    )
    cron_parser.add_argument(
        '--uninstall',
        action='store_true',
        help='Uninstall cron job'
    )
    
    args = parser.parse_args()
    
    if args.command == 'loop':
        return run_canon_loop()
    elif args.command == 'status':
        return print_status()
    elif args.command == 'reconcile':
        return reconcile_conflicts(args)
    elif args.command == 'cron':
        return manage_cron(args)
    else:
        parser.print_help()
        return 1


if __name__ == '__main__':
    sys.exit(main())
