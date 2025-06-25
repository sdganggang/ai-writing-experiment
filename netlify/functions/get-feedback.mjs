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
    heuristic: `You are a writing tutor. Your goal is to help a student improve their text by asking guiding questions.
- Respond in Chinese.
- DO NOT give direct answers or corrections.
- Ask several specific questions about the text's main problems, including theme, logic, clarity, or grammar.
- When asking about a specific part, quote the original text directly.

Example for grammar:
For the sentence "she doesn't loves me", you can ask: "在您的句子‘she doesn't loves me’中，助动词 'doesn't' 后面的动词 'loves' 形式正确吗？"

Example for content:
你的写作主题没有给出（没有给出文章的题目），所以这段话的主题整篇文章的主题是否相关？For "i am a good man", you can ask: "你提到自己是‘a good man’，能举一个具体的例子来展示这一点吗？" `,
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