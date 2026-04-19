import os
import re
import time
import uuid
from typing import Dict, List, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Key

DEFAULT_SESSIONS_TABLE = "aws-architect-sessions"
DEFAULT_MESSAGES_TABLE = "aws-architect-messages"
DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
DEFAULT_CHAT_HISTORY_LIMIT = 20


dynamodb = boto3.resource("dynamodb")


def _resolve_sessions_table_name() -> str:
    return (
        os.getenv("SESSIONS_TABLE")
        or os.getenv("SESSION_TABLE")
        or DEFAULT_SESSIONS_TABLE
    )


def _resolve_messages_table_name() -> str:
    return (
        os.getenv("MESSAGES_TABLE")
        or os.getenv("MESSAGE_TABLE")
        or DEFAULT_MESSAGES_TABLE
    )


sessions_table = dynamodb.Table(_resolve_sessions_table_name())
messages_table = dynamodb.Table(_resolve_messages_table_name())
session_ttl_seconds = int(os.getenv("SESSION_TTL_SECONDS", str(DEFAULT_SESSION_TTL_SECONDS)))
chat_history_limit = int(os.getenv("CHAT_HISTORY_LIMIT", str(DEFAULT_CHAT_HISTORY_LIMIT)))
session_sort_value = os.getenv("SESSION_SORT_VALUE", "SESSION")

_key_schema_cache: Dict[str, Tuple[str, Optional[str]]] = {}


MERMAID_BLOCK_PATTERN = re.compile(r"```mermaid\s*(.*?)```", re.IGNORECASE | re.DOTALL)


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


def _session_primary_key(session_id: str) -> Dict[str, str]:
    hash_key, range_key = _get_table_keys(sessions_table)
    key: Dict[str, str] = {hash_key: session_id}
    if range_key:
        key[range_key] = session_sort_value
    return key


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


def ensure_session(session_id: str, state: str = "ARCH_DRAFT") -> None:
    now = now_epoch_seconds()
    hash_key, range_key = _get_table_keys(sessions_table)

    item = {
        hash_key: session_id,
        "state": state,
        "revision": 0,
        "createdAt": now,
        "updatedAt": now,
        "expiresAt": expires_at_epoch_seconds(),
    }
    if range_key:
        item[range_key] = session_sort_value

    try:
        sessions_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(#pk)",
            ExpressionAttributeNames={"#pk": hash_key},
        )
    except sessions_table.meta.client.exceptions.ConditionalCheckFailedException:
        touch_session(session_id)


def touch_session(session_id: str) -> None:
    sessions_table.update_item(
        Key=_session_primary_key(session_id),
        UpdateExpression="SET updatedAt = :updated_at, expiresAt = :expires_at",
        ExpressionAttributeValues={
            ":updated_at": now_epoch_seconds(),
            ":expires_at": expires_at_epoch_seconds(),
        },
    )


def save_message(
    session_id: str,
    role: str,
    content: str,
    mermaid_code: Optional[str] = None,
    cloudformation_yaml: Optional[str] = None,
) -> str:
    messages_hash_key, messages_range_key = _get_table_keys(messages_table)
    message_ts = _message_sort_value()

    item = {
        messages_hash_key: session_id,
        "messageTs": message_ts,
        "role": role,
        "content": content,
        "createdAt": now_epoch_seconds(),
        "expiresAt": expires_at_epoch_seconds(),
    }
    if messages_range_key:
        item[messages_range_key] = message_ts

    if mermaid_code:
        item["mermaid_code"] = mermaid_code

    if cloudformation_yaml:
        item["cloudformation_yaml"] = cloudformation_yaml

    messages_table.put_item(Item=item)
    touch_session(session_id)
    return item["messageTs"]


def get_recent_chat_messages(session_id: str, limit: Optional[int] = None) -> List[Dict]:
    message_limit = limit or chat_history_limit
    messages_hash_key, messages_range_key = _get_table_keys(messages_table)

    query_args = {
        "KeyConditionExpression": Key(messages_hash_key).eq(session_id),
        "Limit": message_limit,
    }
    if messages_range_key:
        query_args["ScanIndexForward"] = False

    response = messages_table.query(**query_args)

    items = response.get("Items", [])
    if messages_range_key:
        items = list(reversed(items))
    chat_messages = []
    for item in items:
        role = item.get("role")
        content = item.get("content")

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
        items = sorted(items, key=lambda item: item.get("createdAt", 0), reverse=True)
    for item in items:
        if item.get("role") != "assistant":
            continue

        content = item.get("content", "")
        mermaid_code = item.get("mermaid_code") or extract_mermaid_code(content)
        if not mermaid_code:
            continue

        return {
            "assistant_message": content,
            "mermaid_code": mermaid_code,
            "messageTs": item.get("messageTs"),
        }

    return None
