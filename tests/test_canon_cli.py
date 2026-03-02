"""Unit tests for canon.cli (Canon CLI commands)."""

import json
import os
import sys
import pytest


class TestCanonCLI:
    """Test cases for canon CLI commands."""
    
    @pytest.fixture(autouse=True)
    def setup_temp_files(self, tmp_path):
        """Set up temporary state files for each test."""
        self.tmp_path = tmp_path
        self.state_file = tmp_path / '.canon_state.json'
        self.cron_file = tmp_path / '.canon_cron_installed'
        
        # Patch the constants in the module
        import canon.cli as canon_cli
        canon_cli.CANON_STATE_FILE = str(self.state_file)
        canon_cli.CRON_MARKER_FILE = str(self.cron_file)
        
        yield
        
        # Cleanup is automatic with tmp_path
    
    def test_get_state_returns_default(self):
        """Test get_state returns default structure when no file exists."""
        from canon.cli import get_state
        
        state = get_state()
        
        assert state['version'] == 1
        assert state['last_loop'] is None
        assert state['conflicts'] == []
        assert state['world_state'] == {}
    
    def test_get_state_returns_existing_data(self):
        """Test get_state returns existing data from file."""
        from canon.cli import get_state
        
        test_data = {
            'version': 1,
            'last_loop': '2024-01-01T00:00:00',
            'conflicts': [{'id': 1, 'type': 'character'}],
            'world_state': {'characters': 5}
        }
        
        with open(self.state_file, 'w') as f:
            json.dump(test_data, f)
        
        state = get_state()
        
        assert state['last_loop'] == '2024-01-01T00:00:00'
        assert len(state['conflicts']) == 1
        assert state['world_state']['characters'] == 5
    
    def test_save_state_writes_to_file(self):
        """Test save_state writes data to file."""
        from canon.cli import save_state
        
        test_data = {
            'version': 1,
            'last_loop': '2024-01-01T00:00:00',
            'conflicts': [],
            'world_state': {'characters': 10}
        }
        
        save_state(test_data)
        
        # Verify file was written
        with open(self.state_file, 'r') as f:
            saved = json.load(f)
        
        assert saved['world_state']['characters'] == 10
    
    def test_run_canon_loop_updates_state(self):
        """Test run_canon_loop updates the state."""
        from canon.cli import get_state, run_canon_loop
        
        result = run_canon_loop()
        
        assert result == 0
        state = get_state()
        assert state['last_loop'] is not None
        assert 'world_state' in state
    
    def test_print_status_outputs_correct_format(self, capsys):
        """Test print_status outputs correct format."""
        from canon.cli import print_status, save_state
        
        # Pre-populate state
        state = {
            'version': 1,
            'last_loop': '2024-01-01T12:00:00',
            'conflicts': [],
            'world_state': {
                'characters': 5,
                'locations': 3,
                'events': 10,
                'relationships': 20
            }
        }
        save_state(state)
        
        result = print_status()
        
        assert result == 0
        captured = capsys.readouterr()
        assert 'Canon Status' in captured.out
        assert 'Version: 1' in captured.out
        assert 'Characters: 5' in captured.out
        assert 'Locations: 3' in captured.out
    
    def test_reconcile_no_conflicts(self, capsys):
        """Test reconcile with no conflicts."""
        from canon.cli import reconcile_conflicts, save_state
        
        # Create argparse namespace mock
        class Args:
            resolve_all = False
        
        state = {'conflicts': []}
        save_state(state)
        
        result = reconcile_conflicts(Args())
        
        assert result == 0
        captured = capsys.readouterr()
        assert 'No conflicts' in captured.out
    
    def test_reconcile_with_conflicts(self, capsys):
        """Test reconcile shows conflicts."""
        from canon.cli import reconcile_conflicts, save_state
        
        class Args:
            resolve_all = False
        
        state = {
            'conflicts': [
                {'id': 1, 'type': 'character', 'description': 'Name conflict'},
                {'id': 2, 'type': 'location', 'description': 'Duplicate location'}
            ]
        }
        save_state(state)
        
        result = reconcile_conflicts(Args())
        
        assert result == 0
        captured = capsys.readouterr()
        assert 'Found 2 conflict' in captured.out
        assert 'Name conflict' in captured.out
    
    def test_reconcile_resolve_all(self):
        """Test reconcile with --resolve-all flag."""
        from canon.cli import reconcile_conflicts, save_state, get_state
        
        class Args:
            resolve_all = True
        
        state = {
            'conflicts': [
                {'id': 1, 'type': 'character'},
                {'id': 2, 'type': 'location'}
            ]
        }
        save_state(state)
        
        result = reconcile_conflicts(Args())
        
        assert result == 0
        new_state = get_state()
        assert len(new_state['conflicts']) == 0
    
    def test_cron_status_not_installed(self, capsys):
        """Test cron status when not installed."""
        from canon.cli import manage_cron
        
        class Args:
            install = False
            uninstall = False
        
        result = manage_cron(Args())
        
        assert result == 0
        captured = capsys.readouterr()
        assert 'not installed' in captured.out
    
    def test_cron_install(self, capsys):
        """Test cron install creates marker file."""
        from canon.cli import manage_cron
        
        class Args:
            install = True
            uninstall = False
        
        result = manage_cron(Args())
        
        assert result == 0
        assert os.path.exists(self.cron_file)
        captured = capsys.readouterr()
        assert 'installed' in captured.out.lower() or 'cron marker' in captured.out.lower()
    
    def test_cron_uninstall(self, capsys):
        """Test cron uninstall removes marker file."""
        from canon.cli import manage_cron
        
        # First install
        class ArgsInstall:
            install = True
            uninstall = False
        
        manage_cron(ArgsInstall())
        
        # Then uninstall
        class ArgsUninstall:
            install = False
            uninstall = True
        
        result = manage_cron(ArgsUninstall())
        
        assert result == 0
        assert not os.path.exists(self.cron_file)
        captured = capsys.readouterr()
        assert 'uninstalled' in captured.out.lower() or 'cron marker' in captured.out.lower()
    
    def test_cron_status_installed(self, capsys):
        """Test cron status when installed."""
        from canon.cli import manage_cron
        
        # Create marker file
        with open(self.cron_file, 'w') as f:
            f.write('2024-01-01T00:00:00')
        
        class Args:
            install = False
            uninstall = False
        
        result = manage_cron(Args())
        
        assert result == 0
        captured = capsys.readouterr()
        assert 'installed' in captured.out.lower()
    
    def test_main_loop_command(self):
        """Test main entry point with loop command."""
        import canon.cli as canon_cli
        
        # Temporarily patch argv
        old_argv = sys.argv
        try:
            sys.argv = ['canon_cli', 'loop']
            result = canon_cli.main()
            assert result == 0
        finally:
            sys.argv = old_argv
    
    def test_main_status_command(self):
        """Test main entry point with status command."""
        import canon.cli as canon_cli
        
        old_argv = sys.argv
        try:
            sys.argv = ['canon_cli', 'status']
            result = canon_cli.main()
            assert result == 0
        finally:
            sys.argv = old_argv
    
    def test_main_reconcile_command(self):
        """Test main entry point with reconcile command."""
        import canon.cli as canon_cli
        
        old_argv = sys.argv
        try:
            sys.argv = ['canon_cli', 'reconcile']
            result = canon_cli.main()
            assert result == 0
        finally:
            sys.argv = old_argv
    
    def test_main_cron_command(self):
        """Test main entry point with cron command."""
        import canon.cli as canon_cli
        
        old_argv = sys.argv
        try:
            sys.argv = ['canon_cli', 'cron']
            result = canon_cli.main()
            assert result == 0
        finally:
            sys.argv = old_argv
    
    def test_main_unknown_command(self):
        """Test main entry point with unknown command."""
        import canon.cli as canon_cli
        
        old_argv = sys.argv
        try:
            sys.argv = ['canon_cli', 'unknown']
            # argparse exits with status 2 for invalid command
            with pytest.raises(SystemExit) as exc_info:
                canon_cli.main()
            assert exc_info.value.code == 2
        finally:
            sys.argv = old_argv
    
    def test_main_no_command(self):
        """Test main entry point with no command shows help."""
        import canon.cli as canon_cli
        
        old_argv = sys.argv
        old_stdout = sys.stdout
        try:
            sys.argv = ['canon_cli']
            sys.stdout = open(os.devnull, 'w')  # Suppress help output
            result = canon_cli.main()
            assert result == 1
        finally:
            sys.argv = old_argv
            sys.stdout = old_stdout


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
