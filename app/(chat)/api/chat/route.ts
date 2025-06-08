/**
 * 聊天API路由处理器
 * 功能：处理聊天消息的创建、AI回复生成、文档操作和聊天删除
 */

// 1. 导入依赖模块
import { convertToCoreMessages, CoreMessage, Message, StreamData, streamObject, streamText, } from 'ai';
import { z } from 'zod';

import { customModel } from '@/ai';
import { models } from '@/ai/models';
import { systemPrompt } from '@/ai/prompts';
import { getChatById, getDocumentById } from '@/db/cached-queries';
import { deleteChatById, saveChat, saveDocument, saveMessages, saveSuggestions, } from '@/db/mutations';
import { createClient } from '@/lib/supabase/server';
import { MessageRole } from '@/lib/supabase/types';
import { generateUUID, getMostRecentUserMessage, sanitizeResponseMessages, } from '@/lib/utils';

import { generateTitleFromUserMessage } from '../../actions';

// 2. 配置和类型定义
// 2.1. 设置最大执行时间为60秒
export const maxDuration = 60;

// 2.2. 定义允许使用的工具类型
type AllowedTools =
  | 'createDocument' // 创建文档
  | 'updateDocument' // 更新文档
  | 'requestSuggestions' // 请求建议
  | 'getWeather'; // 获取天气

// 2.3. 工具分组配置
const blocksTools: AllowedTools[] = [
  'createDocument',
  'updateDocument',
  'requestSuggestions',
];

const weatherTools: AllowedTools[] = ['getWeather'];

const allTools: AllowedTools[] = [...blocksTools, ...weatherTools];

// 3. 辅助函数定义
// 3.1. 获取当前用户信息
async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Unauthorized');
  }

  return user;
}

// 3.2. 格式化消息内容以便数据库存储
function formatMessageContent(message: CoreMessage): string {
  // 3.2.1. 用户消息：存储为纯文本
  if (message.role === 'user') {
    return typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);
  }

  // 3.2.2. 工具消息：格式化为工具结果数组
  if (message.role === 'tool') {
    return JSON.stringify(
      message.content.map((content) => ({
        type: content.type || 'tool-result',
        toolCallId: content.toolCallId,
        toolName: content.toolName,
        result: content.result,
      }))
    );
  }

  // 3.2.3. 助手消息：格式化为文本和工具调用数组
  if (message.role === 'assistant') {
    if (typeof message.content === 'string') {
      return JSON.stringify([{ type: 'text', text: message.content }]);
    }

    return JSON.stringify(
      message.content.map((content) => {
        if (content.type === 'text') {
          return {
            type: 'text',
            text: content.text,
          };
        }
        return {
          type: 'tool-call',
          toolCallId: content.toolCallId,
          toolName: content.toolName,
          args: content.args,
        };
      })
    );
  }

  return '';
}

// 4. POST请求处理器 - 处理聊天消息和AI回复
export async function POST(request: Request) {
  // 4.1. 解析请求数据
  const {
    id,
    messages,
    modelId,
  }: { id: string; messages: Array<Message>; modelId: string } =
    await request.json();

  // 4.2. 用户身份验证
  const user = await getUser();

  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 4.3. 模型验证
  const model = models.find((model) => model.id === modelId);

  if (!model) {
    return new Response('Model not found', { status: 404 });
  }

  // 4.4. 消息处理和验证
  const coreMessages = convertToCoreMessages(messages);
  const userMessage = getMostRecentUserMessage(coreMessages);

  if (!userMessage) {
    return new Response('No user message found', { status: 400 });
  }

  try {
    // 4.5. 聊天记录处理
    // 4.5.1. 检查聊天是否已存在
    const chat = await getChatById(id);

    if (!chat) {
      // 4.5.2. 创建新聊天记录
      const title = await generateTitleFromUserMessage({
        message: userMessage,
      });
      await saveChat({ id, userId: user.id, title });
    } else if (chat.user_id !== user.id) {
      // 4.5.3. 验证聊天所有权
      return new Response('Unauthorized', { status: 401 });
    }

    // 4.6. 保存用户消息到数据库
    await saveMessages({
      chatId: id,
      messages: [
        {
          id: generateUUID(),
          chat_id: id,
          role: userMessage.role as MessageRole,
          content: formatMessageContent(userMessage),
          created_at: new Date().toISOString(),
        },
      ],
    });

    // 4.7. 创建流式数据对象
    const streamingData = new StreamData();

    // 4.8. 配置AI流式文本生成
    const result = await streamText({
      model: customModel(model.apiIdentifier),
      system: systemPrompt,
      messages: coreMessages,
      maxSteps: 5,
      experimental_activeTools: allTools,
      tools: {
        // 4.8.1. 获取天气工具
        getWeather: {
          description: 'Get the current weather at a location',
          parameters: z.object({
            latitude: z.number(),
            longitude: z.number(),
          }),
          execute: async ({ latitude, longitude }) => {
            const response = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`
            );

            const weatherData = await response.json();
            return weatherData;
          },
        },
        // 4.8.2. 创建文档工具
        createDocument: {
          description: 'Create a document for a writing activity',
          parameters: z.object({
            title: z.string(),
          }),
          execute: async ({ title }) => {
            const id = generateUUID();
            let draftText: string = '';

            // 4.8.2.1. 立即发送UI更新以改善用户体验
            streamingData.append({ type: 'id', content: id });
            streamingData.append({ type: 'title', content: title });
            streamingData.append({ type: 'clear', content: '' });

            // 4.8.2.2. 生成文档内容
            const { fullStream } = await streamText({
              model: customModel(model.apiIdentifier),
              system:
                'Write about the given topic. Markdown is supported. Use headings wherever appropriate.',
              prompt: title,
            });

            // 4.8.2.3. 流式处理生成的内容
            for await (const delta of fullStream) {
              const { type } = delta;

              if (type === 'text-delta') {
                draftText += delta.textDelta;
                // 实时流式传输内容更新
                streamingData.append({
                  type: 'text-delta',
                  content: delta.textDelta,
                });
              }
            }

            // 4.8.2.4. 处理保存重试逻辑（已注释）
            // let attempts = 0;
            // const maxAttempts = 3;
            // let savedId: string | null = null;

            // while (attempts < maxAttempts && !savedId) {
            //   try {
            //     await saveDocument({
            //       id,
            //       title,
            //       content: draftText,
            //       userId: user.id,
            //     });
            //     savedId = id;
            //     break;
            //   } catch (error) {
            //     attempts++;
            //     if (attempts === maxAttempts) {
            //       // 如果原ID失败，尝试使用新ID
            //       const newId = generateUUID();
            //       try {
            //         await saveDocument({
            //           id: newId,
            //           title,
            //           content: draftText,
            //           userId: user.id,
            //         });
            //         // 在UI中更新ID
            //         streamingData.append({ type: 'id', content: newId });
            //         savedId = newId;
            //       } catch (finalError) {
            //         console.error('Final attempt failed:', finalError);
            //         return {
            //           error:
            //             'Failed to create document after multiple attempts',
            //         };
            //       }
            //     }
            //     await new Promise((resolve) =>
            //       setTimeout(resolve, 100 * attempts)
            //     );
            //   }
            // }

            // 4.8.2.5. 发送完成信号
            streamingData.append({ type: 'finish', content: '' });

            // 4.8.2.6. 保存文档到数据库
            if (user && user.id) {
              await saveDocument({
                id,
                title,
                content: draftText,
                userId: user.id,
              });
            }

            return {
              id,
              title,
              content: `A document was created and is now visible to the user.`,
            };
          },
        },
        // 4.8.3. 更新文档工具
        updateDocument: {
          description: 'Update a document with the given description',
          parameters: z.object({
            id: z.string().describe('The ID of the document to update'),
            description: z
              .string()
              .describe('The description of changes that need to be made'),
          }),
          execute: async ({ id, description }) => {
            // 4.8.3.1. 获取现有文档
            const document = await getDocumentById(id);

            if (!document) {
              return {
                error: 'Document not found',
              };
            }

            const { content: currentContent } = document;
            let draftText: string = '';

            // 4.8.3.2. 清空并准备更新
            streamingData.append({
              type: 'clear',
              content: document.title,
            });

            // 4.8.3.3. 生成更新后的内容
            const { fullStream } = await streamText({
              model: customModel(model.apiIdentifier),
              system:
                'You are a helpful writing assistant. Based on the description, please update the piece of writing.',
              experimental_providerMetadata: {
                openai: {
                  prediction: {
                    type: 'content',
                    content: currentContent,
                  },
                },
              },
              messages: [
                {
                  role: 'user',
                  content: description,
                },
                { role: 'user', content: currentContent },
              ],
            });

            // 4.8.3.4. 流式处理更新内容
            for await (const delta of fullStream) {
              const { type } = delta;

              if (type === 'text-delta') {
                const { textDelta } = delta;

                draftText += textDelta;
                streamingData.append({
                  type: 'text-delta',
                  content: textDelta,
                });
              }
            }

            // 4.8.3.5. 发送完成信号并保存
            streamingData.append({ type: 'finish', content: '' });

            if (user && user.id) {
              await saveDocument({
                id,
                title: document.title,
                content: draftText,
                userId: user.id,
              });
            }

            return {
              id,
              title: document.title,
              content: 'The document has been updated successfully.',
            };
          },
        },
        // 4.8.4. 请求建议工具
        requestSuggestions: {
          description: 'Request suggestions for a document',
          parameters: z.object({
            documentId: z
              .string()
              .describe('The ID of the document to request edits'),
          }),
          execute: async ({ documentId }) => {
            // 4.8.4.1. 获取文档内容
            const document = await getDocumentById(documentId);

            if (!document || !document.content) {
              return {
                error: 'Document not found',
              };
            }

            // 4.8.4.2. 初始化建议数组
            let suggestions: Array<{
              originalText: string;
              suggestedText: string;
              description: string;
              id: string;
              documentId: string;
              isResolved: boolean;
            }> = [];

            // 4.8.4.3. 生成改进建议
            const { elementStream } = await streamObject({
              model: customModel(model.apiIdentifier),
              system:
                'You are a help writing assistant. Given a piece of writing, please offer suggestions to improve the piece of writing and describe the change. It is very important for the edits to contain full sentences instead of just words. Max 5 suggestions.',
              prompt: document.content,
              output: 'array',
              schema: z.object({
                originalSentence: z.string().describe('The original sentence'),
                suggestedSentence: z
                  .string()
                  .describe('The suggested sentence'),
                description: z
                  .string()
                  .describe('The description of the suggestion'),
              }),
            });

            // 4.8.4.4. 流式处理建议
            for await (const element of elementStream) {
              const suggestion = {
                originalText: element.originalSentence,
                suggestedText: element.suggestedSentence,
                description: element.description,
                id: generateUUID(),
                documentId: documentId,
                isResolved: false,
              };

              streamingData.append({
                type: 'suggestion',
                content: suggestion,
              });

              suggestions.push(suggestion);
            }

            // 4.8.4.5. 保存建议到数据库
            if (user && user.id) {
              const userId = user.id;

              await saveSuggestions({
                suggestions: suggestions.map((suggestion) => ({
                  ...suggestion,
                  userId,
                  createdAt: new Date(),
                  documentCreatedAt: document.created_at,
                })),
              });
            }

            // 4.8.4.6. 替代保存方法（已注释）
            // if (user && user.id) {
            //   for (const suggestion of suggestions) {
            //     await saveSuggestions({
            //       documentId: suggestion.documentId,
            //       documentCreatedAt: document.created_at,
            //       originalText: suggestion.originalText,
            //       suggestedText: suggestion.suggestedText,
            //       description: suggestion.description,
            //       userId: user.id,
            //     });
            //   }
            // }

            return {
              id: documentId,
              title: document.title,
              message: 'Suggestions have been added to the document',
            };
          },
        },
      },
      // 4.9. 处理流式响应完成回调
      onFinish: async ({ responseMessages }) => {
        if (user && user.id) {
          try {
            // 4.9.1. 清理不完整的工具调用
            const responseMessagesWithoutIncompleteToolCalls =
              sanitizeResponseMessages(responseMessages);

            // 4.9.2. 保存AI回复消息
            await saveMessages({
              chatId: id,
              messages: responseMessagesWithoutIncompleteToolCalls.map(
                (message) => {
                  const messageId = generateUUID();

                  // 4.9.3. 为助手消息添加注释
                  if (message.role === 'assistant') {
                    streamingData.appendMessageAnnotation({
                      messageIdFromServer: messageId,
                    });
                  }

                  return {
                    id: messageId,
                    chat_id: id,
                    role: message.role as MessageRole,
                    content: formatMessageContent(message),
                    created_at: new Date().toISOString(),
                  };
                }
              ),
            });
          } catch (error) {
            console.error('Failed to save chat:', error);
          }
        }

        // 4.9.4. 关闭流式数据连接
        streamingData.close();
      },
      // 4.10. 启用遥测
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'stream-text',
      },
    });

    // 4.11. 返回流式响应
    return result.toDataStreamResponse({
      data: streamingData,
    });
  } catch (error) {
    // 4.12. 错误处理
    console.error('Error in chat route:', error);
    if (error instanceof Error && error.message === 'Chat ID already exists') {
      // 4.12.1. 如果聊天已存在，继续保存消息
      await saveMessages({
        chatId: id,
        messages: [
          {
            id: generateUUID(),
            chat_id: id,
            role: userMessage.role as MessageRole,
            content: formatMessageContent(userMessage),
            created_at: new Date().toISOString(),
          },
        ],
      });
    } else {
      throw error; // 重新抛出其他错误
    }
  }
}

// 5. DELETE请求处理器 - 删除聊天记录
export async function DELETE(request: Request) {
  // 5.1. 解析查询参数
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new Response('Not Found', { status: 404 });
  }

  // 5.2. 用户身份验证
  const user = await getUser();

  try {
    // 5.3. 检查聊天是否存在
    const chat = await getChatById(id);

    if (!chat) {
      return new Response('Chat not found', { status: 404 });
    }

    // 5.4. 验证聊天所有权
    if (chat.user_id !== user.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 5.5. 删除聊天记录
    await deleteChatById(id, user.id);

    return new Response('Chat deleted', { status: 200 });
  } catch (error) {
    // 5.6. 错误处理
    console.error('Error deleting chat:', error);
    return new Response('An error occurred while processing your request', {
      status: 500,
    });
  }
}
