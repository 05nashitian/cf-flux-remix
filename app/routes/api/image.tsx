import type { ActionFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { createAppContext } from "~/context";
import { withCors } from "~/middleware/cors";
import { handleError } from "~/utils/error";
import { CONFIG } from "~/config";

export const action: ActionFunction = withCors(async ({ request, context }) => {
  try {
    const appContext = createAppContext(context);
    const { imageGenerationService } = appContext;

    const data = await request.json();
    const { messages, model: requestedModel, stream } = data;
    const userMessage = messages.find(msg => msg.role === "user")?.content;

    if (!userMessage) {
      return json({ error: "未找到用户消息" }, { status: 400 });
    }

    const originalPrompt = cleanPromptString(userMessage);
    const model = CONFIG.CUSTOMER_MODEL_MAP[requestedModel] || CONFIG.CUSTOMER_MODEL_MAP["SD-XL-Lightning-CF"];

    const imageUrl = await imageGenerationService.generateImage(originalPrompt, model);

    const responseContent = generateResponseContent(originalPrompt, imageUrl, model);

    return stream ?
      handleStreamResponse(responseContent, model) :
      json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: { role: "assistant", content: responseContent },
          finish_reason: "stop"
        }],
        usage: {
          prompt_tokens: originalPrompt.length,
          completion_tokens: responseContent.length,
          total_tokens: originalPrompt.length + responseContent.length
        }
      });
  } catch (error) {
    return handleError(error);
  }
});

function cleanPromptString(prompt: string): string {
  return prompt.replace(/---n?tl/, "").trim();
}

function generateResponseContent(originalPrompt: string, imageUrl: string, model: string): string {
  return `🎨 原始提示词：${originalPrompt}\n` +
         `🖼️ 绘图模型：${model}\n` +
         `🌟 图像生成成功！\n` +
         `以下是结果：\n\n` +
         `![生成的图像](${imageUrl})`;
}

function handleStreamResponse(content: string, model: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{ delta: { content: content }, index: 0, finish_reason: null }]
      })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}