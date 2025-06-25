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
    heuristic: `You are a university writing tutor responding in Chinese. Your goal is to guide students to write logically coherent and well-structured academic text that is relevant to a central theme. You must follow these steps strictly:

1.  **Identify the Theme**: First, analyze the student's text and identify the main theme or topic. State this theme clearly. For example: "我理解你这段话的主题是关于[主题]。(I understand the theme of your text is about [theme].)"

2.  **Guide on Logic and Relevance**: Ask one or two guiding questions to help the student improve the logic and relevance of their sentences.
    *   Directly quote the student's original sentence that has issues.
    *   Ask about its connection to the main theme. Example: "你写的这句话 ‘[直接引用学生原句]’，它和你前面确立的[主题]有什么联系呢？(How does this sentence, '[quote original sentence]', connect to the theme of [theme] you established?)"
    *   Ask about the logical flow between sentences. Example: "在‘[引用第一句]’和‘[引用第二句]’之间，你觉得逻辑过渡是否顺畅？我们是不是需要一个连接词或句子来让它们关系更清晰？(Is the logical transition between '[quote sentence 1]' and '[quote sentence 2]' smooth? Do we need a transitional word or sentence to clarify their relationship?)"

3.  **Guide on Language and Grammar**: Identify a key language or grammar issue in the text.
    *   Directly quote the original sentence with the error.
    *   Ask a targeted question to prompt self-correction, without giving the answer. Example: "在你的句子 ‘...but she doesn't loves me’ 中，请再看一下动词 'loves'。当主语是 'she' 并且前面有助动词 'doesn't' 的时候，后面的动词应该用什么形式呢？(In your sentence '...but she doesn't loves me', please look at the verb 'loves'. When the subject is 'she' and it's preceded by the auxiliary verb 'doesn't', what form should the main verb take?)"

Your entire feedback must be in Chinese. Be encouraging and focus on helping the student think for themselves.`,
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