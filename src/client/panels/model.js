// 客户端真源码（lib/client.js 是构建产物，勿手改）。
// 模型面板：这个角色跑在哪个 provider / 模型 / 推理强度上。

import { describe, note, section } from './../notes.js';
import { h } from './../react.js';
import { styles } from './../styles.js';

/** 三态：跟随模板（空）/ 指定。指定时写一行 agent-default-model。 */
function ModelPanel({ role, catalog, busy, onSet }) {
  const model = role.model ?? { provider: '', model: '', reasoningEffort: '' };
  const specified = String(model.provider ?? '') !== '' && String(model.model ?? '') !== '';
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  const current = providers.find((entry) => entry.id === model.provider);
  const models = current === undefined ? [] : current.models;
  const currentModel = models.find((entry) => entry.id === model.model);
  const efforts = currentModel === undefined ? [] : currentModel.efforts;
  const catalogError = typeof catalog?.error === 'string' ? catalog.error : '';

  return h(
    'div',
    { style: styles.field },
    section(
      '模型',
      specified ? 'modelOn' : 'modelOff',
      note(
        describe(
          'modelIntro',
          '不指定就跟模板走：这个角色用什么模型，取决于所选模式里部署配的默认模型。',
        ),
        describe(
          'modelRow',
          '指定时会在这个角色的预设里加一行 agent-default-model（provider / model / reasoningEffort），只作用于绑到这个角色的成员。',
        ),
        catalogError === '' ? '' : describe('modelCatalog', '读不到模型清单（{error}），可以手填。', { error: catalogError }),
      ),
    ),
    h(
      'div',
      { style: styles.row },
      h('input', {
        type: 'checkbox',
        disabled: busy,
        checked: specified,
        title: specified ? '这个角色用自己的模型' : '这个角色跟随模板的默认模型',
        onChange: (event) => {
          if (!event.target.checked) {
            onSet({ provider: '', model: '', reasoningEffort: '' });
            return;
          }
          // 勾上时三格还是空的，挑当前部署的第一个 provider 与它的第一个模型填进去，
          // 否则「指定」这个状态建不起来（空 provider + 空 model 会被宿主判为跟随模板）。
          const first = providers[0];
          if (first === undefined) return;
          // 该 provider 一个模型都列不出来时先不动：宿主会拒「只给 provider」，
          // 让用户自己在下拉下面手填模型 id。
          if (!Array.isArray(first.models) || first.models.length === 0) return;
          onSet({ provider: first.id, model: first.models[0].id, reasoningEffort: '' });
        },
      }),
      h('span', null, '指定模型（不勾 = 跟随模板）'),
    ),
    specified
      ? h(
          'div',
          null,
          h(
            'select',
            {
              style: styles.select,
              value: model.provider,
              disabled: busy,
              title: 'provider',
              onChange: (event) => {
                const next = providers.find((entry) => entry.id === event.target.value);
                // 新 provider 列不出模型时只换 provider 会被宿主拒绝，保持原样等手填。
                if (next === undefined || next.models.length === 0) return;
                onSet({ provider: event.target.value, model: next.models[0].id, reasoningEffort: '' });
              },
            },
            providers.length === 0
              ? h('option', { key: model.provider, value: model.provider }, model.provider)
              : providers.map((entry) =>
                  h('option', { key: entry.id, value: entry.id }, `${entry.label}（${entry.id}）`),
                ),
          ),
          models.length === 0
            ? h('input', {
                style: styles.input,
                type: 'text',
                placeholder: '模型 id（清单读不到，手填）',
                defaultValue: model.model,
                disabled: busy,
                title: 'model',
                onBlur: (event) => {
                  const value = String(event.target.value ?? '').trim();
                  if (value.length === 0 || value === model.model) return;
                  onSet({ ...model, model: value, reasoningEffort: '' });
                },
              })
            : h(
                'select',
                {
                  style: styles.select,
                  value: model.model,
                  disabled: busy,
                  title: 'model',
                  onChange: (event) => onSet({ ...model, model: event.target.value, reasoningEffort: '' }),
                },
                models.map((entry) => h('option', { key: entry.id, value: entry.id }, entry.label ?? entry.id)),
              ),
          h(
            'select',
            {
              style: styles.select,
              value: model.reasoningEffort ?? '',
              disabled: busy,
              title: 'reasoning effort',
              onChange: (event) => onSet({ ...model, reasoningEffort: event.target.value }),
            },
            h('option', { key: '', value: '' }, '推理强度：适配器默认'),
            efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, effort.name)),
          ),
        )
      : null,
  );
}

export { ModelPanel };
