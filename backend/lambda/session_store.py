import os
import re
import time
import uuid
from typing import Dict, List, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Key

DEFAULT_MESSAGES_TABLE = "aws-architect-messages"
DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
DEFAULT_CHAT_HISTORY_LIMIT = 60
DEFAULT_CHAT_HISTORY_HARD_CAP = 120
DEFAULT_HISTORY_MESSAGE_MAX_CHARS = 1800
ASSISTANT_MERMAID_SEPARATOR = "\n\n<<<MERMAID_DIAGRAM>>>\n\n"


dynamodb = boto3.resource("dynamodb")


def _resolve_messages_table_name() -> str:
    return (
        os.getenv("MESSAGES_TABLE")
        or os.getenv("MESSAGE_TABLE")
        or DEFAULT_MESSAGES_TABLE
    )


messages_table = dynamodb.Table(_resolve_messages_table_name())
session_ttl_seconds = int(os.getenv("SESSION_TTL_SECONDS", str(DEFAULT_SESSION_TTL_SECONDS)))
chat_history_limit = int(os.getenv("CHAT_HISTORY_LIMIT", str(DEFAULT_CHAT_HISTORY_LIMIT)))
chat_history_hard_cap = int(os.getenv("CHAT_HISTORY_HARD_CAP", str(DEFAULT_CHAT_HISTORY_HARD_CAP)))
history_message_max_chars = int(
    os.getenv("HISTORY_MESSAGE_MAX_CHARS", str(DEFAULT_HISTORY_MESSAGE_MAX_CHARS))
)

_key_schema_cache: Dict[str, Tuple[str, Optional[str]]] = {}


MERMAID_BLOCK_PATTERN = re.compile(r"```mermaid\s*(.*?)```", re.IGNORECASE | re.DOTALL)


def _is_resource_not_found_error(error: Exception) -> bool:
    message = str(error)
    return "ResourceNotFoundException" in message and "Requested resource not found" in message


def _get_table_keys(table) -> Tuple[str, Optional[str]]:
    table_name = table.name
    cached = _key_schema_cache.get(table_name)
    if cached:
        return cached

    description = table.meta.client.describe_table(TableName=table_name)["Table"]
    hash_key = next(
        key["AttributeName"] for key in description["KeySchema"] if key["KeyType"] == "HASH"
    )
    range_key = next(
        (key["AttributeName"] for key in description["KeySchema"] if key["KeyType"] == "RANGE"),
        None,
    )

    _key_schema_cache[table_name] = (hash_key, range_key)
    return hash_key, range_key


def _message_sort_value() -> str:
    return build_message_ts()


def generate_session_id() -> str:
    return str(uuid.uuid4())


def now_epoch_seconds() -> int:
    return int(time.time())


def expires_at_epoch_seconds() -> int:
    return now_epoch_seconds() + session_ttl_seconds


def build_message_ts() -> str:
    # Include a random suffix so messages that land in the same millisecond are still unique.
    return f"{int(time.time() * 1000):013d}-{uuid.uuid4().hex[:8]}"


def build_assistant_message_content(assistant_text: str, mermaid_code: Optional[str] = None) -> str:
    if not mermaid_code:
        return (assistant_text or "").strip()

    normalized_text = (assistant_text or "").strip()
    mermaid_block = f"```mermaid\n{mermaid_code.strip()}\n```"
    if not normalized_text:
        normalized_text = "Architecture response"
    return f"{normalized_text}{ASSISTANT_MERMAID_SEPARATOR}{mermaid_block}"


def parse_assistant_message_content(message_content: str) -> Tuple[str, Optional[str]]:
    content = (message_content or "").strip()
    if not content:
        return "", None

    if ASSISTANT_MERMAID_SEPARATOR not in content:
        return content, extract_mermaid_code(content)

    assistant_text, mermaid_segment = content.split(ASSISTANT_MERMAID_SEPARATOR, 1)
    return assistant_text.strip(), extract_mermaid_code(mermaid_segment)


def save_message(
    session_id: str,
    role: str,
    message_content: str,
    message_type: str = "standard",
) -> str:
    messages_hash_key, messages_range_key = _get_table_keys(messages_table)
    message_ts = _message_sort_value()
    created_at = now_epoch_seconds()
    expires_at = expires_at_epoch_seconds()
    mermaid_code = extract_mermaid_code(message_content) if role == "assistant" else None

    item = {
        messages_hash_key: session_id,
        "messageTs": message_ts,
        "role": role,
        "message_type": message_type,
        "message_content": message_content,
        "content": message_content,
        "createdAt": created_at,
        "expiresAt": expires_at,
    }
    if mermaid_code:
        item["mermaid_code"] = mermaid_code
    if messages_range_key:
        item[messages_range_key] = message_ts

    messages_table.put_item(Item=item)
    return item["messageTs"]


def _compact_history_content(content: str) -> str:
    normalized = (content or "").strip()
    if not normalized:
        return ""

    # Keep memory context concise so long-running chats still fit model context.
    if len(normalized) <= history_message_max_chars:
        return normalized

    truncated = normalized[: history_message_max_chars].rstrip()
    return f"{truncated}\n\n[truncated for context window]"


def get_recent_chat_messages(session_id: str, limit: Optional[int] = None) -> List[Dict]:
    requested_limit = limit or chat_history_limit
    message_limit = max(1, min(requested_limit, chat_history_hard_cap))
    messages_hash_key, messages_range_key = _get_table_keys(messages_table)

    items: List[Dict] = []
    last_evaluated_key = None

    while len(items) < message_limit:
        remaining = message_limit - len(items)
        query_args = {
            "KeyConditionExpression": Key(messages_hash_key).eq(session_id),
            "Limit": remaining,
        }
        if messages_range_key:
            query_args["ScanIndexForward"] = False
        if last_evaluated_key:
            query_args["ExclusiveStartKey"] = last_evaluated_key

        response = messages_table.query(**query_args)
        items.extend(response.get("Items", []))
        last_evaluated_key = response.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break

    if messages_range_key:
        items = list(reversed(items[-message_limit:]))
    else:
        items = sorted(items, key=lambda item: item.get("messageTs", ""))[-message_limit:]

    chat_messages = []
    for item in items:
        if item.get("message_type", "standard") != "standard":
            continue

        role = item.get("role")
        content = item.get("message_content") or item.get("content")
        content = _compact_history_content(content)

        if role not in ("user", "assistant") or not content:
            continue

        chat_messages.append(
            {
                "role": role,
                "content": [{"text": content}],
            }
        )

    return chat_messages


def extract_mermaid_code(content: str) -> Optional[str]:
    if not content:
        return None

    match = MERMAID_BLOCK_PATTERN.search(content)
    if not match:
        return None

    return match.group(1).strip()


def get_latest_assistant_architecture_context(session_id: str) -> Optional[Dict]:
    messages_hash_key, messages_range_key = _get_table_keys(messages_table)

    query_args = {
        "KeyConditionExpression": Key(messages_hash_key).eq(session_id),
        "Limit": 50,
    }
    if messages_range_key:
        query_args["ScanIndexForward"] = False

    response = messages_table.query(**query_args)

    items = response.get("Items", [])
    if not messages_range_key:
        items = sorted(items, key=lambda item: item.get("messageTs", ""), reverse=True)

    for item in items:
        if item.get("message_type", "standard") != "standard":
            continue

        if item.get("role") != "assistant":
            continue

        content = item.get("message_content") or item.get("content", "")
        assistant_message, mermaid_code = parse_assistant_message_content(content)
        if not mermaid_code:
            continue

        return {
            "assistant_message": assistant_message,
            "mermaid_code": mermaid_code,
            "messageTs": item.get("messageTs"),
        }

    return None
