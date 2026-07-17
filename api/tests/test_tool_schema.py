import pytest

from api.schemas.tool import HttpApiConfig, TransferCallConfig


def test_transfer_call_destination_accepts_initial_context_template():
    config = TransferCallConfig(
        destination="{{initial_context.transfer_destination}}",
    )

    assert config.destination == "{{initial_context.transfer_destination}}"


def test_transfer_call_destination_accepts_provider_specific_literal():
    config = TransferCallConfig(destination="provider-specific-destination")

    assert config.destination == "provider-specific-destination"


def test_transfer_call_static_allows_empty_draft_destination():
    config = TransferCallConfig(destination_source="static", destination="")

    assert config.destination_source == "static"
    assert config.destination == ""


def test_transfer_call_dynamic_requires_resolver():
    with pytest.raises(ValueError, match="resolver is required"):
        TransferCallConfig(destination_source="dynamic", destination="")


def test_transfer_call_dynamic_accepts_resolver_without_destination():
    config = TransferCallConfig(
        destination_source="dynamic",
        destination="",
        resolver={
            "type": "http",
            "url": "https://crm.example.com/resolve-transfer",
        },
    )

    assert config.destination_source == "dynamic"
    assert config.destination == ""
    assert config.resolver is not None


def test_graphql_config_requires_query():
    with pytest.raises(ValueError, match="graphql_query is required"):
        HttpApiConfig(method="POST", url="https://x", body_type="graphql")


def test_graphql_config_accepts_non_empty_query():
    config = HttpApiConfig(
        method="POST",
        url="https://x",
        body_type="graphql",
        graphql_query="mutation($id: ID!){ book(id:$id){ ok } }",
    )

    assert config.body_type == "graphql"
    assert config.graphql_query == "mutation($id: ID!){ book(id:$id){ ok } }"


def test_http_config_defaults_to_json_body_type():
    """Existing configs without body_type validate as json (backwards compat)."""
    config = HttpApiConfig(method="POST", url="https://x")

    assert config.body_type == "json"
    assert config.graphql_query is None
