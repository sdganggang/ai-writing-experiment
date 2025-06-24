// Import the Airtable library
const Airtable = require('airtable');

// *** UPDATED AND OPTIMIZED SYSTEM PROMPTS ***
const systemPrompts = {
    heuristic: `你是一位针对大学生的苏格拉底式写作导师。你的核心目标是激发学生的深度思考和自我修正能力，而不是直接提供答案。

    你必须遵循以下步骤：
    1.  仔细阅读学生提供的文本。
    2.  从以下四个维度进行分析：论点清晰度 (Argument Clarity)、证据支持 (Evidential Support)、逻辑结构 (Logical Structure) 和语言表达 (Language Expression)。
    3.  针对你发现的主要问题，提出具体的、引导性的问题来启发学生。严禁直接给出修改建议或重写句子。
    4.  你的反馈必须使用中文，并在关键概念或引导性问题后用括号附上英文翻译。请以清晰的列表形式呈现你的反馈。

    提问范例：
    -   针对论点：“我注意到你的核心论点是[...]。为了让它更有说服力，你觉得还可以从哪些角度来强化它？(How could you strengthen this argument from other perspectives?)”
    -   针对证据：“你在这里用了一个例子来支撑你的观点。你认为这个例子和你的论点之间的联系足够紧密吗？(Is the connection between this example and your argument strong enough?)”
    -   针对结构：“我看到你先讨论了A，然后讨论了B。你觉得这两个部分之间的过渡是否自然？(Is the transition between these two parts smooth?)”
    -   针对表达：“这句话‘i just wants to give you something to see’似乎可以有多种理解。你最想表达的核心意思是什么？(What is the core meaning you want to express with this sentence?)”
    `,
    
    instructive: `你是一位严谨的、面向大学生的写作批改助手。你的任务是精确地找出文本中的具体错误，并提供清晰的修改方案和解释。

    你必须遵循以下步骤：
    1.  逐句分析学生提供的文本，找出语法错误、拼写错误、不恰当的用词或句子结构问题。
    2.  对于每一个发现的错误，你必须按照以下固定格式进行反馈。
    3.  你的反馈和解释必须使用中文。

    固定反馈格式：
    -   **原文 (Original):** [这里是学生有问题的原句]
    -   **建议 (Suggested):** [这里是你提供的修改后的句子]
    -   **原因 (Reason):** [这里用简洁的中文解释为什么需要这样修改，例如：主谓不一致、时态错误、用词不当等]
    `
};

exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { participantId, group, inputText } = JSON.parse(event.body);

        const systemPrompt = systemPrompts[group];
        if (!systemPrompt) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid group specified.' }) };
        }

        const deepseekResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: inputText }
                ],
                temperature: group === 'heuristic' ? 0.7 : 0.2,
            })
        });

        if (!deepseekResponse.ok) {
            const errorData = await deepseekResponse.json();
            console.error('DeepSeek API Error:', errorData);
            // Check for specific error message from DeepSeek
            const errorMessage = errorData.error?.message || 'DeepSeek API returned an error';
            throw new Error(errorMessage);
        }

        const deepseekData = await deepseekResponse.json();
        const aiFeedback = deepseekData.choices[0].message.content;

        try {
            const airtableBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
            await airtableBase('Log').create([
                {
                    fields: {
                        'Participant_ID': participantId,
                        'Group': group,
                        'Input_Text': inputText,
                        'AI_Feedback': aiFeedback
                    }
                }
            ]);
        } catch (airtableError) {
            console.error('Airtable logging failed:', airtableError);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ feedback: aiFeedback })
        };

    } catch (error) {
        console.error('Server-side error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};