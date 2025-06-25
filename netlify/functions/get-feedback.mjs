// Using ES Modules syntax for modern compatibility
import axios from 'axios';
import jwt from 'jsonwebtoken';

// Function to generate the API token for Zhipu AI
const generateToken = (apiKey, expSeconds) => {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.includes('.')) {
        throw new Error('Invalid Zhipu API Key format.');
    }
    const [id, secret] = apiKey.split('.');
    const payload = {
        api_key: id,
        exp: Math.floor(Date.now() / 1000) + expSeconds,
        timestamp: Date.now(),
    };
    return jwt.sign(payload, secret, { algorithm: 'HS256', header: { alg: 'HS256', sign_type: 'SIGN' } });
};

const systemPrompts = {
    heuristic: `You are a university writing tutor responding in Chinese. Your goal is to help students reflect and improve their writing by asking guiding questions. You are strictly forbidden from rewriting sentences or giving direct answers.

Your feedback should focus on these two areas:

1.  **思想与结构 (Content & Structure):**
    *   如果论点不清晰，问: "你这篇文章最核心的观点是什么？你觉得读者能一眼看出来吗？(What is the main thesis of your essay? Do you think it's immediately clear to the reader?)"
    *   如果缺乏证据，问: "你用什么具体的例子或数据来支持这个说法的？(What specific examples or data could you use to support this claim?)"
    *   如果逻辑不连贯，问: "这部分和上一部分是如何联系起来的？(How does this section connect to the previous one?)"

2.  **语言与表达 (Language & Phrasing):**
    *   如果发现语法错误 (例如 "I just wants to give you..."), 问: "请再读一遍这句话中的动词‘wants’，你觉得它和主语‘I’匹配吗？(Please re-read the verb 'wants' in this sentence. Do you feel it agrees with the subject 'I'?)"
    *   如果句子表达不自然，问: "这句话有没有更地道或者更学术的表达方式？你可以尝试换一种说法吗？(Is there a more idiomatic or academic way to phrase this? Could you try rephrasing it?)"

Please provide your feedback as a short, friendly list of 2-3 key questions to guide the student.`,
    instructive: `你是一位严谨的、面向大学生的写作批改助手。你的任务是精确地找出文本中的具体错误，并提供清晰的修改方案和解释。你必须遵循以下步骤：1. 逐句分析学生提供的文本，找出语法错误、拼写错误、不恰当的用词或句子结构问题。2. 对于每一个发现的错误，你必须按照以下固定格式进行反馈。3. 你的反馈和解释必须使用中文。固定反馈格式：\n- **原文 (Original):** [学生原句]\n- **建议 (Suggested):** [修改后句子]\n- **原因 (Reason):** [修改原因]`
};

const logToAirtable = async (data) => {
    const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
        console.error("Airtable environment variables not set.");
        return; // Don't block the function if logging fails
    }

    const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Log`;
    try {
        await axios.post(airtableUrl, { records: [{ fields: data }] }, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' }
        });
        console.log(`Airtable log successful for Participant: ${data.Participant_ID}`);
    } catch (error) {
        console.error("Airtable logging failed:", error.response ? error.response.data : error.message);
    }
};

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { ZHIPU_API_KEY } = process.env;
        if (!ZHIPU_API_KEY) {
            throw new Error('Server configuration error: ZHIPU_API_KEY is not set.');
        }

        const { participantId, group, inputText } = JSON.parse(event.body);
        const systemPrompt = systemPrompts[group];

        if (!systemPrompt) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid group specified.' }) };
        }

        const token = generateToken(ZHIPU_API_KEY, 3600);

        const zhipuResponse = await axios.post('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
            model: "glm-4",
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: inputText }],
            temperature: group === 'heuristic' ? 0.7 : 0.2,
        }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const aiFeedback = zhipuResponse.data.choices[0].message.content;
        
        // Log to Airtable in the background, but don't wait for it to finish
        logToAirtable({
            'Participant_ID': participantId,
            'Group': group,
            'Input_Text': inputText,
            'AI_Feedback': aiFeedback
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ feedback: aiFeedback }),
        };

    } catch (error) {
        console.error("Handler Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An unknown server error occurred.' }),
        };
    }
};