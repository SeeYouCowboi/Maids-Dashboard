"""MAID Contract - Parse MAID_COMMIT blocks into structured data."""

import logging

logger = logging.getLogger(__name__)


class ParseError(Exception):
    """Raised when MAID_COMMIT block cannot be parsed."""
    pass


def _parse_value(value_str: str):
    """Parse a YAML value (string, number, boolean, null)."""
    value_str = value_str.strip()
    
    # Null
    if value_str in ('null', '~', 'Null', 'NULL'):
        return None
    
    # Boolean
    if value_str in ('true', 'True', 'TRUE'):
        return True
    if value_str in ('false', 'False', 'FALSE'):
        return False
    
    # Number (int/float)
    try:
        if '.' in value_str:
            return float(value_str)
        return int(value_str)
    except ValueError:
        pass
    
    # String - remove quotes if present
    if (value_str.startswith('"') and value_str.endswith('"')) or \
       (value_str.startswith("'") and value_str.endswith("'")):
        return value_str[1:-1]
    
    return value_str


def _parse(lines, start_idx, base_indent):
    """Main parsing function - parses either dict or list based on first line."""
    if start_idx >= len(lines):
        return {}, start_idx
    
    first_line = lines[start_idx]
    first_content = first_line.lstrip()
    
    # Determine if we're parsing a dict or list
    if first_content.startswith('- '):
        return _parse_list(lines, start_idx, base_indent)
    else:
        return _parse_dict(lines, start_idx, base_indent)


def _parse_dict(lines, start_idx, base_indent):
    """Parse a YAML dict."""
    result = {}
    i = start_idx
    
    while i < len(lines):
        line = lines[i]
        
        if not line.strip():
            i += 1
            continue
        
        if line.strip().startswith('#'):
            i += 1
            continue
        
        indent = len(line) - len(line.lstrip())
        
        if indent < base_indent:
            break
        
        content = line.lstrip()
        
        # List item at dict level means we should stop (caller will handle list)
        if content.startswith('- '):
            break
        
        if ':' in content:
            colon_idx = content.index(':')
            key = content[:colon_idx].strip()
            value = content[colon_idx+1:].strip()
            
            if value:
                result[key] = _parse_value(value)
                i += 1
            else:
                # Check what follows - list or nested dict
                next_idx = i + 1
                found_content = False
                while next_idx < len(lines):
                    next_line = lines[next_idx]
                    if next_line.strip():
                        next_indent = len(next_line) - len(next_line.lstrip())
                        next_content = next_line.lstrip()
                        
                        if next_indent > indent:
                            if next_content.startswith('- '):
                                # It's a list
                                list_val, end_idx = _parse_list(lines, next_idx, indent + 2)
                                result[key] = list_val
                                i = end_idx
                            else:
                                # It's a nested dict
                                dict_val, end_idx = _parse_dict(lines, next_idx, indent + 2)
                                result[key] = dict_val
                                i = end_idx
                            found_content = True
                        break
                    next_idx += 1
                
                if not found_content:
                    result[key] = {}
                    i += 1
        else:
            i += 1
    
    return result, i


def _parse_list(lines, start_idx, base_indent):
    """Parse a YAML list."""
    result = []
    i = start_idx
    
    while i < len(lines):
        line = lines[i]
        
        if not line.strip():
            i += 1
            continue
        
        if line.strip().startswith('#'):
            i += 1
            continue
        
        indent = len(line) - len(line.lstrip())
        
        if indent < base_indent:
            break
        
        content = line.lstrip()
        
        if content.startswith('- '):
            value_part = content[2:]
            
            if value_part.strip():
                # Check if it's inline key:value (should be a dict)
                if ':' in value_part:
                    # Parse as dict - collect all key-values at this indent level
                    item = {}
                    item_indent = indent
                    
                    # Add the first key-value
                    colon_idx = value_part.index(':')
                    key = value_part[:colon_idx].strip()
                    val = value_part[colon_idx+1:].strip()
                    item[key] = _parse_value(val)
                    
                    # Continue collecting key-values at same or deeper indent
                    i += 1
                    while i < len(lines):
                        next_line = lines[i]
                        if not next_line.strip():
                            i += 1
                            continue
                        
                        next_indent = len(next_line) - len(next_line.lstrip())
                        next_content = next_line.lstrip()
                        
                        if next_indent <= indent:
                            break
                        
                        if next_content.startswith('- '):
                            break
                        
                        if ':' in next_content:
                            colon_idx = next_content.index(':')
                            key = next_content[:colon_idx].strip()
                            val = next_content[colon_idx+1:].strip()
                            item[key] = _parse_value(val)
                        
                        i += 1
                    
                    result.append(item)
                else:
                    # Simple scalar
                    result.append(_parse_value(value_part))
                    i += 1
            else:
                # Empty list item - nested dict follows
                nested, end_idx = _parse_dict(lines, i + 1, indent + 2)
                result.append(nested)
                i = end_idx
        else:
            break
    
    return result, i


def _parse_yaml_block(yaml_str: str):
    """Parse a YAML block into Python dict/list structure."""
    lines = yaml_str.split('\n')
    
    # Find first non-empty line
    start_idx = 0
    for i, line in enumerate(lines):
        if line.strip():
            start_idx = i
            break
    
    if start_idx >= len(lines):
        return {}
    
    result, _ = _parse(lines, start_idx, 0)
    return result


def parse_maid_commit(raw: str) -> dict:
    """
    Parse MAID_COMMIT block into structured patch dict.
    
    Input format:
        MAID_COMMIT
        ---
        entities_add:
          - type: person
            name: Alice
        facts_add:
          - subject_name: Alice
            predicate: is
            object_value: wizard
            status: asserted
    
    Returns: {
        "entities_add": [...],
        "facts_add": [...],
        "facts_retire": [...],
        "plot_move": {...},
        "notes": "..."
    }
    
    Raises ParseError on invalid format.
    """
    if not raw:
        raise ParseError("Empty input")
    
    raw = raw.strip()
    
    if not raw.startswith("MAID_COMMIT"):
        raise ParseError("Input must start with 'MAID_COMMIT'")
    
    sep_idx = raw.find("---")
    if sep_idx == -1:
        raise ParseError("Missing '---' separator after MAID_COMMIT")
    
    yaml_content = raw[sep_idx + 3:].strip()
    
    if not yaml_content:
        raise ParseError("No content after '---' separator")
    
    try:
        data = _parse_yaml_block(yaml_content)
    except Exception as e:
        raise ParseError(f"Invalid YAML: {e}")
    
    if data is None:
        raise ParseError("Empty YAML content")
    
    if not isinstance(data, dict):
        raise ParseError("YAML content must be a dictionary")
    
    result = {
        "entities_add": [],
        "facts_add": [],
        "facts_retire": [],
        "plot_move": {},
        "notes": ""
    }
    
    if "entities_add" in data:
        entities = data["entities_add"]
        if not isinstance(entities, list):
            raise ParseError("entities_add must be a list")
        result["entities_add"] = entities
    
    if "facts_add" in data:
        facts = data["facts_add"]
        if not isinstance(facts, list):
            raise ParseError("facts_add must be a list")
        result["facts_add"] = facts
    
    if "facts_retire" in data:
        facts = data["facts_retire"]
        if not isinstance(facts, list):
            raise ParseError("facts_retire must be a list")
        result["facts_retire"] = facts
    
    if "plot_move" in data:
        plot_move = data["plot_move"]
        if not isinstance(plot_move, dict):
            raise ParseError("plot_move must be a dictionary")
        result["plot_move"] = plot_move
    
    if "notes" in data:
        notes = data["notes"]
        if not isinstance(notes, str):
            raise ParseError("notes must be a string")
        result["notes"] = notes
    
    return result
