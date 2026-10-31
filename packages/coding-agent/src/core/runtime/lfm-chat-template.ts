/**
 * LFM2.5 speaks tool calls as `<|tool_call_start|>[name(arg='value')]<|tool_call_end|>`.
 * The GGUF metadata template only appends a JSON tool list and drops tool_calls,
 * so llama.cpp cannot parse the dialect and the model narrates the tool result.
 * This is Liquid's chat template, with string arguments rendered instead of rejected.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toolDialect } from "./tool-dialect.ts";

export const LFM_CHAT_TEMPLATE = `{{- bos_token -}}
{%- set preserve_thinking = preserve_thinking | default(keep_past_thinking | default(false)) -%}

{%- macro format_arg_value(arg_value) -%}
    {%- if arg_value is string -%}
        {{- "'" + (arg_value | replace("\\\\", "\\\\\\\\") | replace("'", "\\\\'") | replace("\\n", "\\\\n") | replace("\\r", "\\\\r")) + "'" -}}
    {%- elif arg_value is mapping or arg_value is iterable -%}
        {{- arg_value | tojson -}}
    {%- else -%}
        {{- arg_value | string -}}
    {%- endif -%}
{%- endmacro -%}

{%- macro parse_content(content) -%}
    {%- if content is string -%}
        {{- content -}}
    {%- elif content is mapping -%}
        {{- content | tojson -}}
    {%- elif content is iterable -%}
        {%- set _ns = namespace(result="") -%}
        {%- for item in content -%}
            {%- if item is string -%}
                {%- set _ns.result = _ns.result + item -%}
            {%- elif item is mapping and item.get("type") == "text" -%}
                {%- set _ns.result = _ns.result + ((item.get("text") or "") | string) -%}
            {%- else -%}
                {%- set _ns.result = _ns.result + (item | tojson) -%}
            {%- endif -%}
        {%- endfor -%}
        {{- _ns.result -}}
    {%- endif -%}
{%- endmacro -%}

{%- macro render_tool_calls(tool_calls) -%}
    {%- set tool_calls_ns = namespace(tool_calls=[]) -%}
    {%- for tool_call in tool_calls -%}
        {%- set func = tool_call["function"] if "function" in tool_call else tool_call -%}
        {%- set func_name = func["name"] -%}
        {%- set func_args = func.get("arguments") -%}
        {%- set args_ns = namespace(arg_strings=[]) -%}
        {%- if func_args is mapping -%}
            {%- for arg_name, arg_value in func_args.items() -%}
                {%- set args_ns.arg_strings = args_ns.arg_strings + [arg_name + "=" + format_arg_value(arg_value)] -%}
            {%- endfor -%}
        {%- elif func_args is string and (func_args | trim) not in ["", "{}", "null"] -%}
            {%- set args_ns.arg_strings = args_ns.arg_strings + [func_args] -%}
        {%- endif -%}
        {%- set tool_calls_ns.tool_calls = tool_calls_ns.tool_calls + [func_name + "(" + (args_ns.arg_strings | join(", ")) + ")"] -%}
    {%- endfor -%}
    {{- "<|tool_call_start|>[" + (tool_calls_ns.tool_calls | join(", ")) + "]<|tool_call_end|>" -}}
{%- endmacro -%}

{%- set ns = namespace(system_prompt="", last_assistant_index=-1) -%}
{%- if messages and messages[0]["role"] == "system" -%}
    {%- if messages[0].get("content") -%}
        {%- set ns.system_prompt = parse_content(messages[0]["content"]) -%}
    {%- endif -%}
    {%- set messages = messages[1:] -%}
{%- endif -%}
{%- if tools -%}
    {%- set ns.system_prompt = ns.system_prompt + ("\\n" if ns.system_prompt else "") + "List of tools: [" -%}
    {%- for tool in tools -%}
        {%- if tool is not string -%}
            {%- set tool = tool | tojson -%}
        {%- endif -%}
        {%- set ns.system_prompt = ns.system_prompt + tool -%}
        {%- if not loop.last -%}
            {%- set ns.system_prompt = ns.system_prompt + ", " -%}
        {%- endif -%}
    {%- endfor -%}
    {%- set ns.system_prompt = ns.system_prompt + "]" -%}
    {%- set ns.system_prompt = ns.system_prompt + "\\nCall a tool as <|tool_call_start|>[name(arg='value')]<|tool_call_end|> and nothing else." -%}
{%- endif -%}
{%- if ns.system_prompt -%}
    {{- "<|im_start|>system\\n" + ns.system_prompt + "<|im_end|>\\n" -}}
{%- endif -%}
{%- for message in messages -%}
    {%- if message["role"] == "assistant" -%}
        {%- set ns.last_assistant_index = loop.index0 -%}
    {%- endif -%}
{%- endfor -%}
{%- for message in messages -%}
    {{- "<|im_start|>" + message.role + "\\n" -}}
    {%- if message.role == "assistant" -%}
        {%- generation -%}
        {%- set keep_thinking = preserve_thinking or loop.index0 == ns.last_assistant_index -%}
        {%- set thinking = message.thinking or message.reasoning or message.reasoning_content -%}
        {%- set thinking = thinking if thinking is string else "" -%}
        {%- if thinking and keep_thinking -%}
            {{- "<think>" + thinking + "</think>" -}}
        {%- endif -%}
        {%- set content = "" -%}
        {%- if message.get("content") -%}
            {%- set content = parse_content(message.content) -%}
        {%- endif -%}
        {%- if not keep_thinking and "</think>" in content -%}
            {%- set content = content.split("</think>")[-1] | trim -%}
        {%- endif -%}
        {{- content -}}
        {%- if message.tool_calls -%}
            {{- render_tool_calls(message.tool_calls) -}}
        {%- endif -%}
        {{- "<|im_end|>\\n" -}}
        {%- endgeneration -%}
    {%- elif message.role == "tool" -%}
        {%- if message.get("content") -%}
            {{- "<|tool_response_start|>" + parse_content(message["content"]) + "<|tool_response_end|>" -}}
        {%- endif -%}
        {{- "<|im_end|>\\n" -}}
    {%- else -%}
        {%- if message.get("content") -%}
            {{- parse_content(message["content"]) -}}
        {%- endif -%}
        {{- "<|im_end|>\\n" -}}
    {%- endif -%}
{%- endfor -%}
{%- if add_generation_prompt -%}
    {{- "<|im_start|>assistant\\n" -}}
{%- endif -%}
`;

export function usesLfmToolDialect(modelId: string): boolean {
	return toolDialect(modelId) === "lfm";
}

/** Writes the template where llama-server can read it. The GGUF copy is not this dialect. */
export function lfmChatTemplatePath(): string {
	const path = join(homedir(), ".trek", "lfm2.5-chat-template.jinja");
	mkdirSync(join(homedir(), ".trek"), { recursive: true });
	writeFileSync(path, LFM_CHAT_TEMPLATE);
	return path;
}
